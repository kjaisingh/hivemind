import { customAlphabet, nanoid } from 'nanoid';

const codeAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 3);

export function createGameCode() {
  return `${codeAlphabet()}-${codeAlphabet()}`;
}

export function createInviteToken() {
  return nanoid(10);
}

export function normalizeAnswer(answer) {
  return answer
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) =>
      word.endsWith('s') && word.length > 3 && !/(?:ss|us|is)$/u.test(word) ? word.slice(0, -1) : word,
    )
    .join(' ');
}

export function safeDisplayAnswer(answer) {
  return answer.trim().replace(/\s+/g, ' ');
}

export function toHoursArray(csv) {
  return csv
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function rankByPoints(entries) {
  let previousPoints = null;
  let currentRank = 0;
  return [...entries]
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
    .map((entry, index) => {
      if (entry.points !== previousPoints) {
        currentRank = index + 1;
        previousPoints = entry.points;
      }
      return { ...entry, rank: currentRank };
    });
}

export function buildScoreRows(roundId, totals) {
  const sorted = Array.from(totals.entries())
    .map(([userId, totalScore]) => ({ userId, totalScore }))
    .sort((a, b) => b.totalScore - a.totalScore || a.userId.localeCompare(b.userId));

  let currentRank = 0;
  let previousScore = null;

  return sorted.map((entry, index) => {
    if (previousScore !== entry.totalScore) {
      currentRank = index + 1;
      previousScore = entry.totalScore;
    }

    return {
      roundId,
      userId: entry.userId,
      totalScore: entry.totalScore,
      rank: currentRank,
      medalAwarded: currentRank === 1 && entry.totalScore > 0,
    };
  });
}
