import { z } from 'zod';

const passwordSchema = (minimum = 1) => z
  .string()
  .min(minimum, minimum === 1 ? 'Password is required.' : `Password must be at least ${minimum} characters.`)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Password must be 72 bytes or fewer.');

const trimmedString = (minimum, maximum, label) =>
  z.string().trim().min(minimum, `${label} is required.`).max(maximum, `${label} must be ${maximum} characters or fewer.`);

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').toLowerCase(),
  password: passwordSchema(),
});

export const signUpSchema = loginSchema.extend({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(24, 'Username must be 24 characters or fewer.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores.'),
  password: passwordSchema(8),
});

export const gameSchema = z.object({
  name: trimmedString(2, 80, 'Game name'),
  description: trimmedString(2, 240, 'Description'),
});

export const joinGameSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/, 'Enter a valid game code.'),
});

const questionSchema = z
  .object({
    prompt: trimmedString(1, 240, 'Question'),
    type: z.enum(['TEXT', 'MULTIPLE_CHOICE']).default('TEXT'),
    choices: z.array(trimmedString(1, 120, 'Choice')).max(8).optional(),
  })
  .superRefine((question, context) => {
    if (question.type !== 'MULTIPLE_CHOICE') return;
    const choices = question.choices || [];
    if (choices.length < 2) {
      context.addIssue({ code: 'custom', message: 'Multiple choice questions need at least 2 choices.', path: ['choices'] });
    }
    const normalized = choices.map((choice) => choice.toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: 'custom', message: 'Multiple choice options must be unique.', path: ['choices'] });
    }
  });

export const roundSchema = z
  .object({
    name: trimmedString(1, 80, 'Round name'),
    description: z.string().trim().max(240, 'Description must be 240 characters or fewer.').optional().default(''),
    startsAt: z.iso.datetime({ message: 'Invalid start date.' }),
    expiresAt: z.iso.datetime({ message: 'Invalid expiry date.' }),
    questions: z.array(questionSchema).min(1, 'Add at least one question.').max(20, 'Rounds can have at most 20 questions.'),
  })
  .refine((data) => new Date(data.expiresAt) > new Date(data.startsAt), {
    message: 'Expiry must be after the start time.',
    path: ['expiresAt'],
  });

const answerRowSchema = z.object({
  questionId: z.uuid('Invalid question.'),
  answer: z.string().trim().max(500, 'Answers must be 500 characters or fewer.'),
});

export const answersSchema = z
  .object({ answers: z.array(answerRowSchema).max(20, 'Too many answers.') })
  .superRefine(({ answers }, context) => {
    const ids = answers.map((answer) => answer.questionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Each question can only be answered once.', path: ['answers'] });
    }
  });

export const publishRoundSchema = z.object({
  announcement: z.string().trim().max(5000, 'Announcement must be 5000 characters or fewer.').optional().default(''),
});

export const suggestionSchema = z.object({ prompt: trimmedString(1, 240, 'Suggestion') });
export const promotionSchema = z.object({ roundId: z.uuid('Invalid round.') });

export const emailSettingsSchema = z.object({
  autoRoundOpen: z.boolean(),
  autoResultsLive: z.boolean(),
  expiringHours: z.array(z.coerce.number().int().min(1).max(168)).max(8).transform((hours) => [...new Set(hours)].sort((a, b) => b - a)),
});

export const manualEmailSchema = z.object({
  subject: trimmedString(1, 200, 'Subject'),
  message: trimmedString(1, 5000, 'Message'),
});

export function validationMessage(result, fallback = 'Invalid request.') {
  return result.error?.issues[0]?.message || fallback;
}
