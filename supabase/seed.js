import 'dotenv/config';
import dayjs from 'dayjs';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { supabase, unwrap } from '../server/db.js';
import { normalizeAnswer } from '../server/utils.js';
import { scoreRound } from '../server/scoring.js';

async function wipeExistingData() {
  unwrap(await supabase.from('Session').delete().not('sid', 'is', null));
  unwrap(await supabase.from('Game').delete().not('id', 'is', null));
  unwrap(await supabase.from('User').delete().not('id', 'is', null));
}

async function createUser(email, username, passwordHash) {
  return unwrap(await supabase.from('User').insert({ email, username, passwordHash }).select().single());
}

async function createSubmission(questionId, userId, answer) {
  unwrap(
    await supabase.from('Submission').insert({
      questionId,
      userId,
      rawAnswer: answer,
      normalizedAnswer: normalizeAnswer(answer),
    }),
  );
}

async function main() {
  const demoPassword = process.env.DEMO_PASSWORD || nanoid(16);
  if (!process.env.DEMO_PASSWORD) {
    console.log(`No DEMO_PASSWORD set — generated one. Save it to .env: DEMO_PASSWORD=${demoPassword}`);
  }
  const demoPasswordHash = await bcrypt.hash(demoPassword, 10);

  await wipeExistingData();

  const demoUser = await createUser('demo@hivemind.app', 'demo_player', demoPasswordHash);
  const playerA = await createUser('amy@hivemind.app', 'amy_arc', demoPasswordHash);
  const playerB = await createUser('raj@hivemind.app', 'raj_mode', demoPasswordHash);
  const playerC = await createUser('lee@hivemind.app', 'lee_loop', demoPasswordHash);

  const game = unwrap(
    await supabase
      .from('Game')
      .insert({
        name: 'Office Banter League',
        description: 'Subjective questions for people who definitely should be working.',
        code: 'HIV-001',
        inviteToken: 'office-banter-001',
        adminId: demoUser.id,
      })
      .select()
      .single(),
  );

  unwrap(
    await supabase.from('GameMembership').insert([
      { gameId: game.id, userId: demoUser.id, role: 'ADMIN' },
      { gameId: game.id, userId: playerA.id, role: 'PLAYER' },
      { gameId: game.id, userId: playerB.id, role: 'PLAYER' },
      { gameId: game.id, userId: playerC.id, role: 'PLAYER' },
    ]),
  );

  unwrap(await supabase.from('GameEmailSettings').insert({ gameId: game.id }));

  const closedRound = unwrap(
    await supabase
      .from('Round')
      .insert({
        gameId: game.id,
        name: 'Week 1 - Icebreaker',
        description: 'A warm-up round to calibrate your psychic office powers.',
        status: 'ACTIVE',
        startsAt: dayjs().subtract(8, 'day').toISOString(),
        expiresAt: dayjs().subtract(7, 'day').toISOString(),
        publishedAt: dayjs().subtract(8, 'day').toISOString(),
      })
      .select()
      .single(),
  );

  unwrap(
    await supabase.from('Question').insert([
      { roundId: closedRound.id, position: 1, prompt: 'Best workday snack?' },
      { roundId: closedRound.id, position: 2, prompt: 'Most overused meeting phrase?' },
      { roundId: closedRound.id, position: 3, prompt: 'Ideal Friday team activity?' },
    ]),
  );

  const closedQuestions = unwrap(
    await supabase
      .from('Question')
      .select('*')
      .eq('roundId', closedRound.id)
      .order('position', { ascending: true }),
  );

  await createSubmission(closedQuestions[0].id, demoUser.id, 'Popcorn');
  await createSubmission(closedQuestions[0].id, playerA.id, 'popcorn ');
  await createSubmission(closedQuestions[0].id, playerB.id, 'chips');
  await createSubmission(closedQuestions[0].id, playerC.id, 'chips');

  await createSubmission(closedQuestions[1].id, demoUser.id, 'Let us circle back');
  await createSubmission(closedQuestions[1].id, playerA.id, 'circle back');
  await createSubmission(closedQuestions[1].id, playerB.id, 'great question');
  await createSubmission(closedQuestions[1].id, playerC.id, 'great question');

  await createSubmission(closedQuestions[2].id, demoUser.id, 'Lunch');
  await createSubmission(closedQuestions[2].id, playerA.id, 'Lunch');
  await createSubmission(closedQuestions[2].id, playerB.id, 'Bowling');
  await createSubmission(closedQuestions[2].id, playerC.id, 'Bowling');

  await scoreRound(supabase, closedRound.id);
  unwrap(await supabase.from('Round').update({ status: 'CLOSED' }).eq('id', closedRound.id));

  const activeRound = unwrap(
    await supabase
      .from('Round')
      .insert({
        gameId: game.id,
        name: 'Week 2 - Predict the Group',
        description: 'Current live round. Edit your answers until the timer hits zero.',
        status: 'ACTIVE',
        startsAt: dayjs().subtract(30, 'minute').toISOString(),
        expiresAt: dayjs().add(6, 'day').toISOString(),
        publishedAt: dayjs().subtract(30, 'minute').toISOString(),
      })
      .select()
      .single(),
  );

  unwrap(
    await supabase.from('Question').insert([
      { roundId: activeRound.id, position: 1, prompt: 'What app do people open first each morning?' },
      { roundId: activeRound.id, position: 2, prompt: 'Most likely excuse for being 5 minutes late?' },
      { roundId: activeRound.id, position: 3, prompt: 'Which emoji appears most in your group chat?' },
    ]),
  );

  console.log('Seed complete.');
  console.log('Demo accounts (same password): demo@hivemind.app, amy@hivemind.app, raj@hivemind.app, lee@hivemind.app');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
