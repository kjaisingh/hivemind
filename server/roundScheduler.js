import dayjs from 'dayjs';
import { scoreRound } from './scoring.js';
import { sendEmail } from './email.js';
import { toHoursArray } from './utils.js';

async function sendWithDedup(prisma, { dedupeKey, gameId, roundId, recipient, emailType, subject, intro, gameName }) {
  const exists = await prisma.emailDeliveryLog.findUnique({ where: { dedupeKey } });
  if (exists) {
    return;
  }

  await sendEmail({
    to: recipient.email,
    subject,
    intro,
    gameName,
  });

  await prisma.emailDeliveryLog.create({
    data: {
      dedupeKey,
      gameId,
      roundId,
      recipientId: recipient.id,
      emailType,
    },
  });
}

export async function processRounds(prisma) {
  const now = new Date();

  const roundsToClose = await prisma.round.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: {
        lte: now,
      },
    },
    include: {
      game: {
        include: {
          memberships: {
            include: {
              user: true,
            },
          },
          emailSettings: true,
        },
      },
    },
  });

  for (const round of roundsToClose) {
    await scoreRound(prisma, round.id);
    await prisma.round.update({ where: { id: round.id }, data: { status: 'CLOSED' } });

    if (round.game.emailSettings?.autoResultsLive) {
      for (const membership of round.game.memberships) {
        const dedupeKey = `results-live:${round.id}:${membership.user.id}`;
        await sendWithDedup(prisma, {
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

  const activeRounds = await prisma.round.findMany({
    where: { status: 'ACTIVE' },
    include: {
      game: {
        include: {
          memberships: { include: { user: true } },
          emailSettings: true,
        },
      },
      questions: true,
    },
  });

  for (const round of activeRounds) {
    const hoursOptions = toHoursArray(round.game.emailSettings?.expiringHoursCsv || '');
    if (hoursOptions.length === 0) {
      continue;
    }

    const submissions = await prisma.submission.findMany({
      where: {
        question: {
          roundId: round.id,
        },
      },
    });

    const submittedQuestionPairs = new Set(submissions.map((item) => `${item.userId}:${item.questionId}`));
    const questionIds = round.questions.map((question) => question.id);

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
        await sendWithDedup(prisma, {
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

export function startRoundScheduler(prisma) {
  setInterval(async () => {
    try {
      await processRounds(prisma);
    } catch (error) {
      console.error('[scheduler]', error);
    }
  }, 60_000);
}
