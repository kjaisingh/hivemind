import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import bcrypt from 'bcryptjs';
import { scoreRound } from '../server/scoring.js';

const prisma = new PrismaClient();

async function ensureUser(email, username, passwordHash) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username,
        passwordHash,
      },
    });
  }

  return prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
    },
  });
}

async function ensureSubmission(questionId, userId, answer) {
  await prisma.submission.upsert({
    where: {
      questionId_userId: {
        questionId,
        userId,
      },
    },
    update: {
      rawAnswer: answer,
      normalizedAnswer: answer.toLowerCase().trim(),
    },
    create: {
      questionId,
      userId,
      rawAnswer: answer,
      normalizedAnswer: answer.toLowerCase().trim(),
    },
  });
}

async function main() {
  const demoPasswordHash = await bcrypt.hash('password123', 10);

  const demoUser = await ensureUser('demo@hivemind.app', 'demo_player', demoPasswordHash);
  const playerA = await ensureUser('amy@hivemind.app', 'amy_arc', demoPasswordHash);
  const playerB = await ensureUser('raj@hivemind.app', 'raj_mode', demoPasswordHash);
  const playerC = await ensureUser('lee@hivemind.app', 'lee_loop', demoPasswordHash);

  let game = await prisma.game.findUnique({ where: { code: 'HIV-001' } });
  if (!game) {
    game = await prisma.game.create({
      data: {
        name: 'Office Banter League',
        description: 'Subjective questions for people who definitely should be working.',
        code: 'HIV-001',
        inviteToken: 'office-banter-001',
        adminId: demoUser.id,
        memberships: {
          create: [
            { userId: demoUser.id, role: 'ADMIN' },
            { userId: playerA.id, role: 'PLAYER' },
            { userId: playerB.id, role: 'PLAYER' },
            { userId: playerC.id, role: 'PLAYER' },
          ],
        },
        emailSettings: {
          create: {},
        },
      },
    });
  } else {
    await prisma.gameMembership.upsert({
      where: { gameId_userId: { gameId: game.id, userId: demoUser.id } },
      update: { role: 'ADMIN' },
      create: { gameId: game.id, userId: demoUser.id, role: 'ADMIN' },
    });
    await prisma.gameMembership.upsert({
      where: { gameId_userId: { gameId: game.id, userId: playerA.id } },
      update: {},
      create: { gameId: game.id, userId: playerA.id, role: 'PLAYER' },
    });
    await prisma.gameMembership.upsert({
      where: { gameId_userId: { gameId: game.id, userId: playerB.id } },
      update: {},
      create: { gameId: game.id, userId: playerB.id, role: 'PLAYER' },
    });
    await prisma.gameMembership.upsert({
      where: { gameId_userId: { gameId: game.id, userId: playerC.id } },
      update: {},
      create: { gameId: game.id, userId: playerC.id, role: 'PLAYER' },
    });
  }

  const closedRoundName = 'Week 1 - Icebreaker';
  const hasClosedRound = await prisma.round.findFirst({ where: { gameId: game.id, name: closedRoundName } });
  if (!hasClosedRound) {
    const closedRound = await prisma.round.create({
      data: {
        gameId: game.id,
        name: closedRoundName,
        description: 'A warm-up round to calibrate your psychic office powers.',
        status: 'ACTIVE',
        startsAt: dayjs().subtract(8, 'day').toDate(),
        expiresAt: dayjs().subtract(7, 'day').toDate(),
        publishedAt: dayjs().subtract(8, 'day').toDate(),
        questions: {
          create: [
            { position: 1, prompt: 'Best workday snack?' },
            { position: 2, prompt: 'Most overused meeting phrase?' },
            { position: 3, prompt: 'Ideal Friday team activity?' },
          ],
        },
      },
      include: {
        questions: {
          orderBy: { position: 'asc' },
        },
      },
    });

    await ensureSubmission(closedRound.questions[0].id, demoUser.id, 'Popcorn');
    await ensureSubmission(closedRound.questions[0].id, playerA.id, 'popcorn ');
    await ensureSubmission(closedRound.questions[0].id, playerB.id, 'chips');
    await ensureSubmission(closedRound.questions[0].id, playerC.id, 'chips');

    await ensureSubmission(closedRound.questions[1].id, demoUser.id, 'Let us circle back');
    await ensureSubmission(closedRound.questions[1].id, playerA.id, 'circle back');
    await ensureSubmission(closedRound.questions[1].id, playerB.id, 'great question');
    await ensureSubmission(closedRound.questions[1].id, playerC.id, 'great question');

    await ensureSubmission(closedRound.questions[2].id, demoUser.id, 'Lunch');
    await ensureSubmission(closedRound.questions[2].id, playerA.id, 'Lunch');
    await ensureSubmission(closedRound.questions[2].id, playerB.id, 'Bowling');
    await ensureSubmission(closedRound.questions[2].id, playerC.id, 'Bowling');

    await scoreRound(prisma, closedRound.id);
    await prisma.round.update({
      where: { id: closedRound.id },
      data: { status: 'CLOSED' },
    });
  }

  const activeRoundName = 'Week 2 - Predict the Group';
  const hasActiveRound = await prisma.round.findFirst({
    where: { gameId: game.id, name: activeRoundName, status: 'ACTIVE' },
  });

  if (!hasActiveRound) {
    await prisma.round.create({
      data: {
        gameId: game.id,
        name: activeRoundName,
        description: 'Current live round. Edit your answers until the timer hits zero.',
        status: 'ACTIVE',
        startsAt: dayjs().subtract(30, 'minute').toDate(),
        expiresAt: dayjs().add(6, 'day').toDate(),
        publishedAt: dayjs().subtract(30, 'minute').toDate(),
        questions: {
          create: [
            { position: 1, prompt: 'What app do people open first each morning?' },
            { position: 2, prompt: 'Most likely excuse for being 5 minutes late?' },
            { position: 3, prompt: 'Which emoji appears most in your group chat?' },
          ],
        },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
