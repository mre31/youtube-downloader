import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, apiError, downloadOptions, jsonObject, selectFormat, youtubeUrl } from '../src/lib/api-input.ts';

const id = 'jNQXAC9IVRw';
test('normalizes watch, short, embed, live and mobile links to a single video', () => {
  for (const url of [`https://youtu.be/${id}?t=5`, `https://www.youtube.com/watch?v=${id}&list=ignored`,
    `https://m.youtube.com/shorts/${id}`, `https://youtube.com/embed/${id}`, `https://youtube.com/live/${id}`]) {
    assert.equal(youtubeUrl(url), `https://www.youtube.com/watch?v=${id}`);
  }
});
test('rejects host spoofing, local targets, credentials, unsupported protocols and playlists', () => {
  for (const url of [null, {}, 42, 'garbage', 'http://localhost/', `https://youtube.com.evil.test/watch?v=${id}`,
    `https://evil.test/youtube.com/${id}`, `ftp://youtube.com/watch?v=${id}`, `https://user@youtube.com/watch?v=${id}`,
    `https://youtube.com:5055/watch?v=${id}`, 'https://youtube.com/playlist?list=abc', 'https://youtu.be/abc']) {
    assert.throws(() => youtubeUrl(url), error => error.status === 400 && error.code === 'INVALID_URL');
  }
});
test('rejects malformed and non-object JSON bodies', async () => {
  for (const body of ['{', 'null', '[]', '42']) {
    await assert.rejects(jsonObject(new Request('http://localhost', { method: 'POST', body })), ApiError);
  }
});
const url = `https://youtu.be/${id}`;
test('defaults to video and rejects ambiguous or unsupported options', () => {
  assert.equal(downloadOptions({ url }).type, 'video');
  for (const fields of [{ type: 'mp3' }, { maxHeight: 0 }, { maxHeight: 720.5 }, { maxHeight: '720' },
    { type: 'audio', maxHeight: 720 }, { formatId: '137' }, { ext: 'mp4' }, { formatId: '', ext: '' }, { quality: 'best' }]) {
    assert.throws(() => downloadOptions({ url, ...fields }), ApiError);
  }
});
const formats = [
  { formatId: '18', ext: 'mp4', resolution: '360p', vcodec: 'avc1', fps: 30, tbr: 500 },
  { formatId: '137+140', ext: 'mp4', resolution: '1080p', vcodec: 'avc1', fps: 30, tbr: 2000 },
  { formatId: '140', ext: 'm4a', resolution: 'Audio', vcodec: 'none', tbr: 128 },
  { formatId: '251', ext: 'webm', resolution: 'Audio', vcodec: 'none', tbr: 160 },
];
test('selects highest resolution or bitrate while respecting explicit format and height', () => {
  const pick = fields => selectFormat(formats, downloadOptions({ url, ...fields }));
  assert.equal(pick({}).formatId, '137+140');
  assert.equal(pick({ maxHeight: 720 }).formatId, '18');
  assert.equal(pick({ type: 'audio' }).formatId, '251');
  assert.equal(pick({ type: 'audio', formatId: '140', ext: 'm4a' }).formatId, '140');
  for (const fields of [{ maxHeight: 100 }, { formatId: '137+140', ext: 'webm' }, { formatId: 'best', ext: 'mp4' }]) {
    assert.throws(() => pick(fields), error => error.status === 422);
  }
});
test('API errors return stable codes and disable caching', async () => {
  const response = apiError(new ApiError(409, 'FILE_NOT_READY', 'Wait for completion.'));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: { code: 'FILE_NOT_READY', message: 'Wait for completion.' } });
});
