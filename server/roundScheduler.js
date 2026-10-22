import dayjs from 'dayjs';
import { scoreRound } from './scoring.js';
import { isEmailConfigured, sendEmail } from './email.js';
import { toHoursArray } from './utils.js';
import { getRoundsForClosing, getActiveRoundsWithContext, getRecentClosedRoundsWithContext } from './repository.js';
import { readByIds, unwrap } from './db.js';

export async function sendWithDedup(supabase, { dedupeKey, gameId, roundId, recipient, emailType, subject, intro, gameName }) {
  if (!isEmailConfigured()) {
    return false;
  }

  const { error: insertError } = await supabase.from('EmailDeliveryLog').insert({
    dedupeKey,
    gameId,
    roundId,
    recipientId: recipient.id,
    emailType,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return false;
    }
    throw new Error(insertError.message);
  }

  try {
    const sent = await sendEmail({
      to: recipient.email,
      subject,
      intro,
      gameName,
      idempotencyKey: dedupeKey,
    });
    if (!sent) {
      await supabase.from('EmailDeliveryLog').delete().eq('dedupeKey', dedupeKey);
      return false;
    }
    return true;
  } catch (error) {
    // Retry transient provider/network failures; dedupe terminal rejections.
    if (error.retryable !== false) {
      await supabase.from('EmailDeliveryLog').delete().eq('dedupeKey', dedupeKey);
    }
    console.error('[email] Automated delivery failed.', {
      dedupeKey,
      retryable: error.retryable !== false,
      status: error.status || null,
    });
    return false;
  }
}

let inFlightProcessRounds = null;

export async function processRounds(supabase) {
  if (inFlightProcessRounds) {
    return inFlightProcessRounds;
  }

  inFlightProcessRounds = runProcessRounds(supabase).finally(() => {
    inFlightProcessRounds = null;
  });

  return inFlightProcessRounds;
}

export async function sweepExpiredSessions(supabase) {
  unwrap(await supabase.from('Session').delete().lt('expiresAt', new Date().toISOString()));
}

async function runProcessRounds(supabase) {
  const now = new Date();
  const roundsToClose = await getRoundsForClosing(supabase, now);
  for (const round of roundsToClose) {
    try {
      await scoreRound(supabase, round.id);
      unwrap(await supabase.from('Round').update({ status: 'CLOSED' }).eq('id', round.id).eq('status', 'ACTIVE'));
    } catch (error) {
      console.error('[scheduler] Round close failed.', { roundId: round.id, error });
    }
  }
}

let inFlightNotifications = null;
export async function processNotifications(supabase) {
  if (!isEmailConfigured()) return;
  if (!inFlightNotifications) {
    inFlightNotifications = runNotifications(supabase).finally(() => { inFlightNotifications = null; });
  }
  return inFlightNotifications;
}

async function runNotifications(supabase) {
  const activeRounds = await getActiveRoundsWithContext(supabase);

  for (const round of activeRounds) {
    try {
      await notifyActiveRound(supabase, round);
    } catch (error) {
      console.error('[scheduler] Active-round notifications failed.', { roundId: round.id, error });
    }
  }
  const closedRounds = await getRecentClosedRoundsWithContext(supabase, new Date());
  for (const round of closedRounds) {
    if (!round.game.emailSettings?.autoResultsLive) continue;
    try {
      for (const membership of round.game.memberships) {
        await sendWithDedup(supabase, {
          dedupeKey: `results-live:${round.id}:${membership.user.id}`,
          gameId: round.gameId,
          roundId: round.id,
          recipient: membership.user,
          emailType: 'RESULTS_LIVE',
          subject: `${round.game.name}: ${round.name} results are live`,
          intro: 'Your scores are ready. Rally your confidence and check who guessed the crowd best.',
          gameName: round.game.name,
        });
      }
    } catch (error) {
      console.error('[scheduler] Results notifications failed.', { roundId: round.id, error });
    }
  }
}

async function notifyActiveRound(supabase, round) {
  if (new Date(round.expiresAt) <= new Date()) return;
  if (round.game.emailSettings?.autoRoundOpen) {
    for (const membership of round.game.memberships) {
      await sendWithDedup(supabase, {
        dedupeKey: `round-open:${round.id}:${membership.user.id}`,
        gameId: round.gameId,
        roundId: round.id,
        recipient: membership.user,
        emailType: 'ROUND_OPEN',
        subject: `${round.game.name}: ${round.name} is live`,
        intro: round.announcementEmail || 'A fresh round just opened. Time to read minds and earn points.',
        gameName: round.game.name,
      });
    }
  }
  const hoursOptions = toHoursArray(round.game.emailSettings?.expiringHoursCsv || '');
  if (hoursOptions.length === 0) {
    return;
  }

  const questionIds = round.questions.map((question) => question.id);
  const submissions = questionIds.length
    ? await readByIds(questionIds, (ids) => supabase.from('Submission').select('questionId,userId').in('questionId', ids))
    : [];

  const submittedQuestionPairs = new Set(submissions.map((item) => `${item.userId}:${item.questionId}`));

  const nowTime = dayjs();
  if (!nowTime.isBefore(dayjs(round.expiresAt))) {
    return;
  }

  const crossedHours = hoursOptions.filter((hours) => !nowTime.isBefore(dayjs(round.expiresAt).subtract(hours, 'hour')));
  if (crossedHours.length === 0) {
    return;
  }
  const hours = Math.min(...crossedHours);

  for (const membership of round.game.memberships) {
    const hasCompletedAll = questionIds.every((questionId) => submittedQuestionPairs.has(`${membership.user.id}:${questionId}`));
    if (hasCompletedAll) {
      continue;
    }

    const dedupeKey = `expiring:${round.id}:${membership.user.id}:${hours}`;
    await sendWithDedup(supabase, {
      dedupeKey,
      gameId: round.gameId,
      roundId: round.id,
      recipient: membership.user,
      emailType: 'EXPIRING_SOON',
      subject: `${round.game.name}: ${round.name} expires in ${hours} hour(s)`,
      intro: `Quick ping: you still have unanswered questions. Your hive awaits your wisdom.`,
      gameName: round.game.name,
    });
  }
}

export function startRoundScheduler(supabase) {
  const run = async () => {
    try {
      await processRounds(supabase);
      await sweepExpiredSessions(supabase);
    } catch (error) {
      console.error('[scheduler]', error);
    }
    void processNotifications(supabase).catch((error) => console.error('[scheduler] Notifications failed.', error));
  };
  void run();
  return setInterval(run, 60_000);
}
