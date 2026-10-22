import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../../src/lib/api.js';

test('API timeout covers a stalled response body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({
    status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }),
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }));
  await assert.rejects(api('/test', { timeoutMs: 20 }), /Request timed out/);
});

test('API preserves default headers and rejects invalid successful responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, { headers }) => {
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['X-Test'], 'yes');
    return new Response('<html>Proxy error</html>', { status: 200 });
  });
  await assert.rejects(api('/test', { headers: { 'X-Test': 'yes' } }), /invalid response/);
});

test('API preserves HTTP errors and explicit cancellation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Busy', { status: 503 }));
  await assert.rejects(api('/test'), (error) => error.message === 'Busy' && error.status === 503);
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => { signal.throwIfAborted(); });
  await assert.rejects(api('/test', { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
