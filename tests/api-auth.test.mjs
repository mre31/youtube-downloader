import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticationError } from '../src/lib/api-auth.ts';

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
      { Authorization: 'Bearer' }, { 'X-API-Key': token }, { Cookie: `downloader_session=${token}` }]) {
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
