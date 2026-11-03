import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticationError, createSession, validSession, SESSION_COOKIE, SESSION_SECONDS } from '../src/lib/api-auth.ts';

const token = 'test-only-token-do-not-use-in-production';
const request = (headers = {}, endpoint = '/api/v1/downloads') => new Request(`http://localhost${endpoint}`, { headers });

test('authentication fails closed without a configured token', async () => {
  const previous = process.env.API_TOKEN;
  try {
    delete process.env.API_TOKEN;
    const response = authenticationError(request({ Authorization: `Bearer ${token}` }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED');
    process.env.API_TOKEN = '   ';
    assert.equal(authenticationError(request()).status, 503);
  } finally {
    if (previous === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous;
  }
});

test('Bearer credentials are mandatory, exact, and independent of query parameters', async () => {
  const previous = process.env.API_TOKEN;
  process.env.API_TOKEN = token;
  try {
    for (const headers of [{}, { Authorization: 'Basic abc' }, { Authorization: `Bearer ${token}wrong` },
      { Authorization: 'Bearer' }, { 'X-API-Key': token }]) {
      const response = authenticationError(request(headers));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="downloader"');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    }
    assert.equal(authenticationError(request({}, `/api/v1/downloads?token=${token}`)).status, 401);
    assert.equal(authenticationError(request({ Authorization: `Bearer ${token}` })), null);
    assert.equal(authenticationError(request({ Authorization: `bearer ${token}` })), null);
  } finally {
    if (previous === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous;
  }
});

test('browser sessions expire, reject tampering, and are revoked by token rotation', () => {
  const now = Date.now();
  const session = createSession(token, now);
  assert.ok(validSession(session, token, now));
  assert.ok(!session.includes(token));
  assert.ok(!validSession(session, token, now + SESSION_SECONDS * 1000));
  assert.ok(!validSession(session, 'rotated-token', now));
  assert.ok(!validSession(`${session}extra`, token, now));
  assert.ok(!validSession(`${session}.extra`, token, now));
  for (const value of ['', '.', 'invalid.session', '123']) assert.equal(validSession(value, token, now), false);
});

test('session cookies authorize browser endpoints only when explicitly allowed', () => {
  const previous = process.env.API_TOKEN;
  process.env.API_TOKEN = token;
  try {
    const req = request({ Cookie: `${SESSION_COOKIE}=${createSession(token)}` }, '/api/info');
    assert.equal(authenticationError(req, true), null);
    assert.equal(authenticationError(req).status, 401);
    assert.equal(authenticationError(request({ Cookie: `${SESSION_COOKIE}=forged` }), true).status, 401);
  } finally {
    if (previous === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous;
  }
});
