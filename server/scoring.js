import { normalizeAnswer, safeDisplayAnswer } from './utils.js';

export async function scoreRound(prisma, roundId) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      game: {
        include: {
          memberships: {
            include: { user: true },
          },
        },
      },
      questions: {
        orderBy: { position: 'asc' },
        include: {
          submissions: true,
        },
      },
    },
  });

  const players = round.game.memberships.map((membership) => membership.user);
  const totals = new Map(players.map((player) => [player.id, 0]));

  for (const question of round.questions) {
    const grouped = new Map();

    for (const submission of question.submissions) {
      const normalized = normalizeAnswer(submission.rawAnswer);
      const existing = grouped.get(normalized) || {
        normalizedAnswer: normalized,
        displayAnswer: safeDisplayAnswer(submission.rawAnswer),
        count: 0,
      };
      existing.count += 1;
      grouped.set(normalized, existing);
    }

    const stats = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
    const totalResponses = question.submissions.length;

    await prisma.questionAnswerStat.deleteMany({ where: { questionId: question.id } });

    if (stats.length > 0) {
      await prisma.questionAnswerStat.createMany({
        data: stats.map((item) => ({
          questionId: question.id,
          normalizedAnswer: item.normalizedAnswer,
          displayAnswer: item.displayAnswer,
          count: item.count,
          percentage: totalResponses > 0 ? (item.count / totalResponses) * 100 : 0,
        })),
      });
    }

    for (const submission of question.submissions) {
      const key = normalizeAnswer(submission.rawAnswer);
      const score = grouped.get(key)?.count || 0;
      totals.set(submission.userId, (totals.get(submission.userId) || 0) + score);
    }
  }

  await prisma.roundScore.deleteMany({ where: { roundId } });

  const sorted = Array.from(totals.entries())
    .map(([userId, totalScore]) => ({ userId, totalScore }))
    .sort((a, b) => b.totalScore - a.totalScore);

  let currentRank = 0;
  let previousScore = null;

  const rows = sorted.map((entry, index) => {
    if (previousScore !== entry.totalScore) {
      currentRank = index + 1;
      previousScore = entry.totalScore;
    }

    return {
      roundId,
      userId: entry.userId,
      totalScore: entry.totalScore,
      rank: currentRank,
      medalAwarded: currentRank === 1,
    };
  });

  if (rows.length > 0) {
    await prisma.roundScore.createMany({ data: rows });
  }
}
