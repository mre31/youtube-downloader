// Run after `npm run build`. Uses a fake yt-dlp; no YouTube network calls.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

await test('production HTTP API: metadata, selection, polling, streaming, errors and legacy compatibility', async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'downloader-api-'));
  const binary = path.join(fixtureDir, 'yt-dlp');
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({ id: 'jNQXAC9IVRw', title: 'API test', duration: 1, formats: [
    { format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a', tbr: 500 },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 128 }
  ] }));
} else {
  setTimeout(() => {
    const ext = args[args.indexOf('-f') + 1] === '140' ? 'm4a' : 'mp4';
    const output = args[args.indexOf('-o') + 1].replace('%(ext)s', ext);
    fs.writeFileSync(output, 'fixture-media');
    fs.writeFileSync(args[args.indexOf('--print-to-file') + 2], output);
  }, 1200);
}
`);
  await chmod(binary, 0o755);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const token = randomBytes(32).toString('hex');
  const authenticatedFetch = (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  const base = `http://127.0.0.1:${port}`;
  let logs = '';
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, API_TOKEN: token, YT_DLP_PATH: binary, FFMPEG_BIN: process.execPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  const jobs = [];
  const post = (endpoint, body) => authenticatedFetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await authenticatedFetch(`${base}/api/health`)).ok; } catch {}
      if (ready) break;
      if (server.exitCode !== null) throw new Error(logs);
      await delay(100);
    }
    assert.ok(ready, logs);
    for (const [endpoint, method] of [
      ['/api/v1/downloads', 'POST'], ['/api/v1/videos/info', 'POST'],
      ['/api/v1/downloads/missing', 'GET'], ['/api/v1/downloads/missing/file', 'GET'],
      ['/api/info', 'POST'], ['/api/download/start', 'POST'],
      ['/api/download/status?id=missing', 'GET'], ['/api/download/file?id=missing', 'GET'],
    ]) {
      const denied = await fetch(`${base}${endpoint}`, { method });
      assert.equal(denied.status, 401, endpoint);
      assert.equal((await fetch(`${base}${endpoint}`, { method, headers: { Authorization: 'Bearer wrong' } })).status, 401);
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/downloads?token=${token}`, { method: 'POST' })).status, 401);
    const login = await authenticatedFetch(`${base}/api/auth`, { method: 'POST' });
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.get('set-cookie');
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=strict/i);
    assert.ok(!sessionCookie.includes(token));
    const cookie = sessionCookie.split(';')[0];
    assert.equal((await fetch(`${base}/api/auth`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/download/status?id=missing`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/v1/downloads/missing`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth`, { method: 'POST', headers: { Cookie: cookie } })).status, 401);
    const logout = await fetch(`${base}/api/auth`, { method: 'DELETE' });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);

    assert.equal((await post('/api/v1/downloads', { url: 'http://localhost/youtube.com' })).status, 400);
    assert.equal((await post('/api/v1/downloads', { url: 'https://youtu.be/jNQXAC9IVRw', maxHeight: 100 })).status, 422);
    assert.equal((await authenticatedFetch(`${base}/api/v1/downloads/missing`)).status, 404);
    assert.equal((await authenticatedFetch(`${base}/api/v1/downloads/missing/file`)).status, 404);
    const malformed = await authenticatedFetch(`${base}/api/v1/downloads`, { method: 'POST', body: '{' });
    assert.equal(malformed.status, 400);
    const info = await post('/api/v1/videos/info', { url: 'https://youtu.be/jNQXAC9IVRw' });
    assert.equal(info.status, 200);
    assert.equal((await info.json()).formats.length, 2);
    for (const type of ['video', 'audio']) {
      const created = await post('/api/v1/downloads', { url: 'https://youtu.be/jNQXAC9IVRw', type });
      assert.equal(created.status, 202);
      const job = await created.json();
      jobs.push(job);
      assert.equal(created.headers.get('location'), job.statusUrl);
      assert.equal(job.format.ext, type === 'video' ? 'mp4' : 'm4a');
      assert.equal((await authenticatedFetch(`${base}${job.fileUrl}`)).status, 409);
      let status;
      for (let i = 0; i < 50; i++) {
        status = await (await authenticatedFetch(`${base}${job.statusUrl}`)).json();
        if (status.status === 'completed' || status.status === 'failed') break;
        await delay(100);
      }
      assert.equal(status.status, 'completed', JSON.stringify(status) + logs);
      assert.equal(status.progress, 100);
      const file = await authenticatedFetch(`${base}${job.fileUrl}`);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-length'), '13');
      assert.match(file.headers.get('content-disposition'), /attachment/);
      assert.equal(await file.text(), 'fixture-media');
      // Both API versions share jobs and files; receiving a file does not delete it.
      const legacy = await authenticatedFetch(`${base}/api/download/file?id=${job.id}`);
      assert.equal(await legacy.text(), 'fixture-media');
      const legacyStatus = await authenticatedFetch(`${base}/api/download/status?id=${job.id}`);
      assert.equal((await legacyStatus.json()).status, 'completed');
      await rm(path.join(process.cwd(), 'temp', `${job.id}.${job.format.ext}`));
      assert.equal((await authenticatedFetch(`${base}${job.fileUrl}`)).status, 410);
      assert.equal((await authenticatedFetch(`${base}${job.statusUrl}`)).status, 410);
    }
  } finally {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
    await rm(fixtureDir, { recursive: true, force: true });
    for (const job of jobs) {
      await rm(path.join(process.cwd(), 'temp', `${job.id}.${job.format.ext}`), { force: true });
      await rm(path.join(process.cwd(), 'temp', `${job.id}.filepath`), { force: true });
    }
  }
});
