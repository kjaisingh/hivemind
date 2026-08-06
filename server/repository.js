import { unwrap } from './db.js';

export async function getDashboardData(supabase, userId) {
  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('userId', userId));
  if (memberships.length === 0) {
    return { memberships: [], answersByRound: {} };
  }

  const gameIds = memberships.map((membership) => membership.gameId);
  const games = unwrap(await supabase.from('Game').select('*').in('id', gameIds));
  const gamesById = new Map(games.map((game) => [game.id, game]));

  const rounds = unwrap(
    await supabase.from('Round').select('*').in('gameId', gameIds).order('expiresAt', { ascending: false }),
  );
  const roundIds = rounds.map((round) => round.id);

  const questions = roundIds.length
    ? unwrap(await supabase.from('Question').select('*').in('roundId', roundIds))
    : [];
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const questionsByRound = new Map();
  for (const question of questions) {
    const list = questionsByRound.get(question.roundId) || [];
    list.push(question);
    questionsByRound.set(question.roundId, list);
  }

  const questionIds = questions.map((question) => question.id);
  const submissions = questionIds.length
    ? unwrap(await supabase.from('Submission').select('*').eq('userId', userId).in('questionId', questionIds))
    : [];

  const answersByRound = {};
  for (const submission of submissions) {
    const question = questionsById.get(submission.questionId);
    if (!question) continue;
    answersByRound[question.roundId] = (answersByRound[question.roundId] || 0) + 1;
  }

  const roundsByGame = new Map();
  for (const round of rounds) {
    const list = roundsByGame.get(round.gameId) || [];
    list.push({ ...round, questions: questionsByRound.get(round.id) || [] });
    roundsByGame.set(round.gameId, list);
  }

  return {
    memberships: memberships.map((membership) => ({
      role: membership.role,
      game: gamesById.get(membership.gameId),
      rounds: roundsByGame.get(membership.gameId) || [],
    })),
    answersByRound,
  };
}

export async function getGameDetail(supabase, gameId) {
  const game = unwrap(await supabase.from('Game').select('*').eq('id', gameId).maybeSingle());
  if (!game) {
    return null;
  }

  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const rounds = unwrap(
    await supabase.from('Round').select('*').eq('gameId', gameId).order('createdAt', { ascending: false }),
  );
  const roundIds = rounds.map((round) => round.id);

  const questions = roundIds.length
    ? unwrap(
        await supabase.from('Question').select('*').in('roundId', roundIds).order('position', { ascending: true }),
      )
    : [];
  const questionsByRound = new Map();
  for (const question of questions) {
    const list = questionsByRound.get(question.roundId) || [];
    list.push(question);
    questionsByRound.set(question.roundId, list);
  }

  const emailSettings = unwrap(
    await supabase.from('GameEmailSettings').select('*').eq('gameId', gameId).maybeSingle(),
  );

  const scores = roundIds.length
    ? unwrap(await supabase.from('RoundScore').select('*').in('roundId', roundIds))
    : [];

  const scoreMap = new Map();
  const medalMap = new Map();
  for (const score of scores) {
    scoreMap.set(score.userId, (scoreMap.get(score.userId) || 0) + score.totalScore);
    if (score.medalAwarded) {
      medalMap.set(score.userId, (medalMap.get(score.userId) || 0) + 1);
    }
  }

  return {
    game,
    memberships: memberships.map((membership) => ({ ...membership, user: usersById.get(membership.userId) })),
    rounds: rounds.map((round) => ({ ...round, questions: questionsByRound.get(round.id) || [] })),
    emailSettings,
    scoreMap,
    medalMap,
  };
}

export async function getRoundResults(supabase, roundId, userId) {
  const round = unwrap(await supabase.from('Round').select('*').eq('id', roundId).maybeSingle());
  if (!round) {
    return null;
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('id', round.gameId).maybeSingle());

  const scores = unwrap(
    await supabase
      .from('RoundScore')
      .select('*')
      .eq('roundId', roundId)
      .order('rank', { ascending: true })
      .order('totalScore', { ascending: false }),
  );
  const scoreUserIds = scores.map((score) => score.userId);
  const scoreUsers = scoreUserIds.length
    ? unwrap(await supabase.from('User').select('*').in('id', scoreUserIds))
    : [];
  const usersById = new Map(scoreUsers.map((user) => [user.id, user]));

  const questions = unwrap(
    await supabase.from('Question').select('*').eq('roundId', roundId).order('position', { ascending: true }),
  );
  const questionIds = questions.map((question) => question.id);

  const answerStats = questionIds.length
    ? unwrap(
        await supabase
          .from('QuestionAnswerStat')
          .select('*')
          .in('questionId', questionIds)
          .order('count', { ascending: false }),
      )
    : [];
  const statsByQuestion = new Map();
  for (const stat of answerStats) {
    const list = statsByQuestion.get(stat.questionId) || [];
    list.push(stat);
    statsByQuestion.set(stat.questionId, list);
  }

  const ownSubmissions = questionIds.length
    ? unwrap(await supabase.from('Submission').select('*').eq('userId', userId).in('questionId', questionIds))
    : [];
  const submissionByQuestion = new Map(ownSubmissions.map((submission) => [submission.questionId, submission]));

  return {
    round,
    game,
    scores: scores.map((score) => ({ ...score, user: usersById.get(score.userId) })),
    questions: questions.map((question) => ({
      ...question,
      answerStats: statsByQuestion.get(question.id) || [],
      submissions: submissionByQuestion.has(question.id) ? [submissionByQuestion.get(question.id)] : [],
    })),
  };
}

export async function getRoundScoringData(supabase, roundId) {
  const round = unwrap(await supabase.from('Round').select('*').eq('id', roundId).maybeSingle());
  if (!round) {
    return null;
  }

  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', round.gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const players = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];

  const questions = unwrap(
    await supabase.from('Question').select('*').eq('roundId', roundId).order('position', { ascending: true }),
  );
  const questionIds = questions.map((question) => question.id);
  const submissions = questionIds.length
    ? unwrap(await supabase.from('Submission').select('*').in('questionId', questionIds))
    : [];
  const submissionsByQuestion = new Map();
  for (const submission of submissions) {
    const list = submissionsByQuestion.get(submission.questionId) || [];
    list.push(submission);
    submissionsByQuestion.set(submission.questionId, list);
  }

  return {
    round,
    players,
    questions: questions.map((question) => ({
      ...question,
      submissions: submissionsByQuestion.get(question.id) || [],
    })),
  };
}

async function attachGameContext(supabase, rounds, { withQuestions = false } = {}) {
  if (rounds.length === 0) {
    return [];
  }

  const gameIds = [...new Set(rounds.map((round) => round.gameId))];
  const games = unwrap(await supabase.from('Game').select('*').in('id', gameIds));
  const gamesById = new Map(games.map((game) => [game.id, game]));

  const memberships = unwrap(await supabase.from('GameMembership').select('*').in('gameId', gameIds));
  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  const users = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const membershipsByGame = new Map();
  for (const membership of memberships) {
    const list = membershipsByGame.get(membership.gameId) || [];
    list.push({ ...membership, user: usersById.get(membership.userId) });
    membershipsByGame.set(membership.gameId, list);
  }

  const emailSettingsRows = unwrap(
    await supabase.from('GameEmailSettings').select('*').in('gameId', gameIds),
  );
  const emailSettingsByGame = new Map(emailSettingsRows.map((row) => [row.gameId, row]));

  const questionsByRound = new Map();
  if (withQuestions) {
    const roundIds = rounds.map((round) => round.id);
    const questions = unwrap(await supabase.from('Question').select('*').in('roundId', roundIds));
    for (const question of questions) {
      const list = questionsByRound.get(question.roundId) || [];
      list.push(question);
      questionsByRound.set(question.roundId, list);
    }
  }

  return rounds.map((round) => ({
    ...round,
    questions: questionsByRound.get(round.id) || [],
    game: {
      ...gamesById.get(round.gameId),
      memberships: membershipsByGame.get(round.gameId) || [],
      emailSettings: emailSettingsByGame.get(round.gameId) || null,
    },
  }));
}

export async function getRoundsForClosing(supabase, now) {
  const rounds = unwrap(
    await supabase.from('Round').select('*').eq('status', 'ACTIVE').lte('expiresAt', now.toISOString()),
  );
  return attachGameContext(supabase, rounds);
}

export async function getActiveRoundsWithContext(supabase) {
  const rounds = unwrap(await supabase.from('Round').select('*').eq('status', 'ACTIVE'));
  return attachGameContext(supabase, rounds, { withQuestions: true });
}
