import dayjs from 'dayjs';
import { scoreRound } from './scoring.js';
import { sendEmail } from './email.js';
import { toHoursArray } from './utils.js';
import { getRoundsForClosing, getActiveRoundsWithContext } from './repository.js';
import { unwrap } from './db.js';

async function sendWithDedup(supabase, { dedupeKey, gameId, roundId, recipient, emailType, subject, intro, gameName }) {
  const exists = unwrap(
    await supabase.from('EmailDeliveryLog').select('*').eq('dedupeKey', dedupeKey).maybeSingle(),
  );
  if (exists) {
    return;
  }

  await sendEmail({
    to: recipient.email,
    subject,
    intro,
    gameName,
  });

  unwrap(
    await supabase.from('EmailDeliveryLog').insert({
      dedupeKey,
      gameId,
      roundId,
      recipientId: recipient.id,
      emailType,
    }),
  );
}

export async function processRounds(supabase) {
  const now = new Date();

  const roundsToClose = await getRoundsForClosing(supabase, now);

  for (const round of roundsToClose) {
    await scoreRound(supabase, round.id);
    unwrap(await supabase.from('Round').update({ status: 'CLOSED' }).eq('id', round.id));

    if (round.game.emailSettings?.autoResultsLive) {
      for (const membership of round.game.memberships) {
        const dedupeKey = `results-live:${round.id}:${membership.user.id}`;
        await sendWithDedup(supabase, {
          dedupeKey,
          gameId: round.gameId,
          roundId: round.id,
          recipient: membership.user,
          emailType: 'RESULTS_LIVE',
          subject: `${round.game.name}: ${round.name} results are live`,
          intro: 'Your scores are ready. Rally your confidence and check who guessed the crowd best.',
          gameName: round.game.name,
        });
      }
    }
  }

  const activeRounds = await getActiveRoundsWithContext(supabase);

  for (const round of activeRounds) {
    const hoursOptions = toHoursArray(round.game.emailSettings?.expiringHoursCsv || '');
    if (hoursOptions.length === 0) {
      continue;
    }

    const questionIds = round.questions.map((question) => question.id);
    const submissions = questionIds.length
      ? unwrap(await supabase.from('Submission').select('*').in('questionId', questionIds))
      : [];

    const submittedQuestionPairs = new Set(submissions.map((item) => `${item.userId}:${item.questionId}`));

    for (const hours of hoursOptions) {
      const triggerStart = dayjs(round.expiresAt).subtract(hours, 'hour');
      const triggerEnd = triggerStart.add(1, 'minute');
      const nowTime = dayjs();
      if (!(nowTime.isAfter(triggerStart) && nowTime.isBefore(triggerEnd))) {
        continue;
      }

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
  }
}

export function startRoundScheduler(supabase) {
  setInterval(async () => {
    try {
      await processRounds(supabase);
    } catch (error) {
      console.error('[scheduler]', error);
    }
  }, 60_000);
}
