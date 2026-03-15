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
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word))
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
