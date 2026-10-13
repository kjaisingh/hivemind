import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { sendEmail } = await import('../../server/email.js');
const { sendWithDedup } = await import('../../server/roundScheduler.js');

function deliveryLogMock(insertError = null) {
  const calls = { deletes: 0, inserts: 0 };
  return {
    calls,
    client: {
      from(table) {
        assert.equal(table, 'EmailDeliveryLog');
        return {
          async insert() {
            calls.inserts += 1;
            return { error: insertError };
          },
          delete() {
            return {
              async eq() {
                calls.deletes += 1;
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

const message = {
  to: 'player@example.com',
  subject: 'Round ready',
  intro: 'Open the round.',
  gameName: 'Test Hive',
};

test('email delivery reports an unconfigured provider without calling fetch', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFallbackKey = process.env.SMTP_PASS;
  const previousFrom = process.env.SMTP_FROM;
  const previousFetch = global.fetch;
  const previousInfo = console.info;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  global.fetch = () => assert.fail('fetch should not be called');
  console.info = () => {};

  try {
    assert.equal(await sendEmail(message), false);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFallbackKey === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = previousFallbackKey;
    if (previousFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousFrom;
    global.fetch = previousFetch;
    console.info = previousInfo;
  }
});

test('email dedupe retries transient failures but retains terminal failures', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.SMTP_FROM;
  const previousFetch = global.fetch;
  const previousError = console.error;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.SMTP_FROM = 'Hivemind <hive@example.com>';
  console.error = () => {};

  const payload = {
    dedupeKey: 'round:player',
    gameId: 'game-id',
    roundId: 'round-id',
    recipient: { id: 'player-id', email: message.to },
    emailType: 'ROUND_OPEN',
    subject: message.subject,
    intro: message.intro,
    gameName: message.gameName,
  };

  try {
    const terminal = deliveryLogMock();
    global.fetch = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ message: 'invalid recipient' }),
    });
    assert.equal(await sendWithDedup(terminal.client, payload), false);
    assert.equal(terminal.calls.deletes, 0);

    const transient = deliveryLogMock();
    global.fetch = async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      json: async () => ({}),
    });
    assert.equal(await sendWithDedup(transient.client, payload), false);
    assert.equal(transient.calls.deletes, 1);

    const rateLimited = deliveryLogMock();
    global.fetch = async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    });
    assert.equal(await sendWithDedup(rateLimited.client, payload), false);
    assert.equal(rateLimited.calls.deletes, 1);

    const duplicate = deliveryLogMock({ code: '23505', message: 'duplicate' });
    assert.equal(await sendWithDedup(duplicate.client, payload), false);
    assert.equal(duplicate.calls.deletes, 0);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousFrom;
    global.fetch = previousFetch;
    console.error = previousError;
  }
});
