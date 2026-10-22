import { readAll, readByIds, unwrap } from './db.js';

export async function getDashboardData(supabase, userId) {
  const memberships = await readAll(supabase.from('GameMembership').select('*').eq('userId', userId));
  if (memberships.length === 0) {
    return { memberships: [], answersByRound: {} };
  }

  const gameIds = memberships.map((membership) => membership.gameId);
  const games = await readByIds(gameIds, (ids) => supabase.from('Game').select('*').in('id', ids));
  const gamesById = new Map(games.map((game) => [game.id, game]));

  const rounds = await readByIds(gameIds, (ids) => supabase.from('Round').select('*').in('gameId', ids).order('expiresAt', { ascending: false }));
  const roundIds = rounds.filter((round) => round.status === 'ACTIVE').map((round) => round.id);

  const questions = roundIds.length
    ? await readByIds(roundIds, (ids) => supabase.from('Question').select('*').in('roundId', ids))
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
    ? await readByIds(questionIds, (ids) => supabase.from('Submission').select('*').eq('userId', userId).in('questionId', ids))
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

  const memberships = await readAll(supabase.from('GameMembership').select('*').eq('gameId', gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? await readByIds(userIds, (ids) => supabase.from('User').select('id,username').in('id', ids)) : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const rounds = await readAll(supabase.from('Round').select('*').eq('gameId', gameId).order('createdAt', { ascending: false }));
  const roundIds = rounds.filter((round) => round.status === 'CLOSED').map((round) => round.id);
  const questionRoundIds = rounds.filter((round) => round.status !== 'CLOSED').map((round) => round.id);

  const questions = questionRoundIds.length
    ? await readByIds(questionRoundIds, (ids) => supabase.from('Question').select('*').in('roundId', ids).order('position', { ascending: true }))
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
    ? await readByIds(roundIds, (ids) => supabase.from('RoundScore').select('*').in('roundId', ids))
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

export async function getRoundResults(supabase, roundId, gameId, userId) {
  const round = unwrap(
    await supabase.from('Round').select('*').eq('id', roundId).eq('gameId', gameId).maybeSingle(),
  );
  if (!round) {
    return null;
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('id', round.gameId).maybeSingle());

  const scores = await readAll(supabase
      .from('RoundScore')
      .select('*')
      .eq('roundId', roundId)
      .order('rank', { ascending: true })
      .order('totalScore', { ascending: false }));
  const scoreUserIds = scores.map((score) => score.userId);
  const scoreUsers = scoreUserIds.length
    ? await readByIds(scoreUserIds, (ids) => supabase.from('User').select('id,username').in('id', ids))
    : [];
  const usersById = new Map(scoreUsers.map((user) => [user.id, user]));

  const questions = await readAll(supabase.from('Question').select('*').eq('roundId', roundId).order('position', { ascending: true }));
  const questionIds = questions.map((question) => question.id);

  const answerStats = questionIds.length
    ? await readByIds(questionIds, (ids) => supabase
          .from('QuestionAnswerStat')
          .select('*')
          .in('questionId', ids)
          .order('count', { ascending: false }))
    : [];
  const statsByQuestion = new Map();
  for (const stat of answerStats) {
    const list = statsByQuestion.get(stat.questionId) || [];
    list.push(stat);
    statsByQuestion.set(stat.questionId, list);
  }

  const ownSubmissions = questionIds.length
    ? await readByIds(questionIds, (ids) => supabase.from('Submission').select('*').eq('userId', userId).in('questionId', ids))
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

async function attachGameContext(supabase, rounds, { withQuestions = false } = {}) {
  if (rounds.length === 0) {
    return [];
  }

  const gameIds = [...new Set(rounds.map((round) => round.gameId))];
  const games = await readByIds(gameIds, (ids) => supabase.from('Game').select('*').in('id', ids));
  const gamesById = new Map(games.map((game) => [game.id, game]));

  const memberships = await readByIds(gameIds, (ids) => supabase.from('GameMembership').select('*').in('gameId', ids));
  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  const users = userIds.length ? await readByIds(userIds, (ids) => supabase.from('User').select('id,email,username').in('id', ids)) : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const membershipsByGame = new Map();
  for (const membership of memberships) {
    const list = membershipsByGame.get(membership.gameId) || [];
    list.push({ ...membership, user: usersById.get(membership.userId) });
    membershipsByGame.set(membership.gameId, list);
  }

  const emailSettingsRows = await readByIds(gameIds, (ids) => supabase.from('GameEmailSettings').select('*').in('gameId', ids));
  const emailSettingsByGame = new Map(emailSettingsRows.map((row) => [row.gameId, row]));

  const questionsByRound = new Map();
  if (withQuestions) {
    const roundIds = rounds.map((round) => round.id);
    const questions = await readByIds(roundIds, (ids) => supabase.from('Question').select('*').in('roundId', ids));
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

export async function getSuggestionsForGame(supabase, gameId) {
  const suggestions = await readAll(supabase
      .from('QuestionSuggestion')
      .select('*')
      .eq('gameId', gameId)
      .order('createdAt', { ascending: false }));
  const userIds = [...new Set(suggestions.map((suggestion) => suggestion.submittedById))];
  const users = userIds.length ? await readByIds(userIds, (ids) => supabase.from('User').select('id,username').in('id', ids)) : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  return suggestions.map((suggestion) => ({
    ...suggestion,
    submittedBy: usersById.get(suggestion.submittedById),
  }));
}

export async function getRoundsForClosing(supabase, now) {
  const rounds = await readAll(supabase.from('Round').select('*').eq('status', 'ACTIVE').lte('expiresAt', now.toISOString()));
  return rounds;
}

export async function getActiveRoundsWithContext(supabase) {
  const rounds = await readAll(supabase.from('Round').select('*').eq('status', 'ACTIVE'));
  return attachGameContext(supabase, rounds, { withQuestions: true });
}

export async function getRecentClosedRoundsWithContext(supabase, now) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rounds = await readAll(supabase.from('Round').select('*').eq('status', 'CLOSED').gte('expiresAt', since).lte('expiresAt', now.toISOString()));
  return attachGameContext(supabase, rounds);
}
