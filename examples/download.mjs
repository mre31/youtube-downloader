// Node.js 24; no third-party dependencies.
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const [url, output = 'download.bin', ...flags] = process.argv.slice(2);
const base = (process.env.API_BASE_URL || 'http://localhost:5055').replace(/\/$/, '');
const token = process.env.API_TOKEN;
const authHeaders = { Authorization: `Bearer ${token}` };
const deadline = AbortSignal.timeout(30 * 60 * 1000);

async function json(path, init) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, ...authHeaders }, signal: deadline });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
  return data;
}

try {
  if (!token) throw new Error('Set API_TOKEN in the environment.');
  if (!url || flags.some(flag => flag !== '--audio' && !/^--max-height=\d+$/.test(flag))) {
    throw new Error('Usage: node examples/download.mjs URL [output-file] [--audio] [--max-height=720]');
  }
  const height = flags.find(flag => flag.startsWith('--max-height='));
  const job = await json('/api/v1/downloads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type: flags.includes('--audio') ? 'audio' : 'video',
      ...(height ? { maxHeight: Number(height.split('=')[1]) } : {}) }),
  });
  console.log(`Job: ${job.id} (${job.format.ext}, ${job.format.qualityLabel})`);
  for (;;) {
    const status = await json(job.statusUrl);
    console.log(`${status.status}: ${status.progress}%`);
    if (status.status === 'failed') throw new Error(status.error.message);
    if (status.status === 'completed') {
      const response = await fetch(`${base}${status.fileUrl}`, { headers: authHeaders, signal: deadline });
      if (!response.ok) throw new Error(`File download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(output, { flags: 'wx' }));
      console.log(`Saved: ${output} (original filename: ${status.filename})`);
      break;
    }
    await delay(2000, undefined, { headers: authHeaders, signal: deadline });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
