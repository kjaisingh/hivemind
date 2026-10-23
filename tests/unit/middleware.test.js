import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTrustedOrigin } from '../../server/middleware.js';

test('write requests reject foreign and opaque browser origins', () => {
  const protect = requireTrustedOrigin('https://hive.example');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
      let status;
      const response = { status(value) { status = value; return this; }, json() {} };
      protect({ method, get: (name) => headers[name] }, response, () => assert.fail('Foreign write reached handler'));
      assert.equal(status, 403);
    }
  }
});

test('same-origin browser writes, direct clients, and read requests remain available', () => {
  const protect = requireTrustedOrigin('https://hive.example');
  for (const [method, headers] of [['POST', { origin: 'https://hive.example' }], ['POST', {}], ['GET', { origin: 'https://elsewhere.example' }], ['OPTIONS', {}]]) {
    let called = false;
    protect({ method, get: (name) => headers[name] }, { status: () => assert.fail('Valid request rejected') }, () => { called = true; });
    assert.equal(called, true);
  }
});
