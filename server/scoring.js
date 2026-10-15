import { buildScoreRows, normalizeAnswer, safeDisplayAnswer } from './utils.js';
import { getRoundScoringData } from './repository.js';
import { unwrap } from './db.js';

export async function scoreRound(supabase, roundId) {
  const data = await getRoundScoringData(supabase, roundId);
  if (!data) return;

  const { players, questions } = data;
  const totals = new Map(players.map((player) => [player.id, 0]));

  for (const question of questions) {
    const grouped = new Map();

    for (const submission of question.submissions) {
      const normalized = normalizeAnswer(submission.rawAnswer);
      const existing = grouped.get(normalized) || {
        normalizedAnswer: normalized,
        displayVariants: new Map(),
        count: 0,
      };
      const display = safeDisplayAnswer(submission.rawAnswer);
      existing.displayVariants.set(display, (existing.displayVariants.get(display) || 0) + 1);
      existing.count += 1;
      grouped.set(normalized, existing);
    }

    const stats = Array.from(grouped.values())
      .map((item) => ({
        normalizedAnswer: item.normalizedAnswer,
        displayAnswer: Array.from(item.displayVariants.entries()).sort((a, b) => b[1] - a[1])[0][0],
        count: item.count,
      }))
      .sort((a, b) => b.count - a.count);
    const totalResponses = question.submissions.length;

    unwrap(await supabase.from('QuestionAnswerStat').delete().eq('questionId', question.id));

    if (stats.length > 0) {
      unwrap(
        await supabase.from('QuestionAnswerStat').upsert(
          stats.map((item) => ({
            questionId: question.id,
            normalizedAnswer: item.normalizedAnswer,
            displayAnswer: item.displayAnswer,
            count: item.count,
            percentage: totalResponses > 0 ? (item.count / totalResponses) * 100 : 0,
          })),
          { onConflict: 'questionId,normalizedAnswer' },
        ),
      );
    }

    for (const submission of question.submissions) {
      const key = normalizeAnswer(submission.rawAnswer);
      const score = grouped.get(key)?.count || 0;
      totals.set(submission.userId, (totals.get(submission.userId) || 0) + score);
    }
  }

  unwrap(await supabase.from('RoundScore').delete().eq('roundId', roundId));

  const rows = buildScoreRows(roundId, totals);

  if (rows.length > 0) {
    unwrap(await supabase.from('RoundScore').upsert(rows, { onConflict: 'roundId,userId' }));
  }
}
