import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoFormats, getFormatArgs, parseDownloadProgress } from '../src/lib/download-options.ts';

const audio = [
  { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 1000 },
  { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 160, filesize: 1200 },
];
const video = {
  format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none',
  height: 1080, tbr: 2000, protocol: 'https', filesize: 10000,
};

test('MP4 uses native AAC, with the matching combined size and container flag', () => {
  const [format] = buildVideoFormats([video, ...audio]);
  assert.equal(format.formatId, '137+140');
  assert.equal(format.ext, 'mp4');
  assert.equal(format.filesize, 11000);
  assert.deepEqual(getFormatArgs(format.formatId, format.ext), ['-f', '137+140', '--postprocessor-args', 'ffmpeg_o:-c copy', '--merge-output-format', 'mp4']);
});

test('prefers direct MP4 over an HLS variant with an inflated bitrate', () => {
  const hls = { ...video, format_id: '312', protocol: 'm3u8_native', tbr: 9000 };
  assert.equal(buildVideoFormats([hls, video, ...audio])[0].formatId, '137+140');
});

test('offers both native audio file types without creating a converted MP3 option', () => {
  const formats = buildVideoFormats(audio);
  assert.deepEqual(formats.map(format => format.ext), ['m4a', 'webm']);
  assert.deepEqual(formats.map(format => format.formatId), ['140', '251']);
  assert.deepEqual(getFormatArgs(formats[0].formatId, formats[0].ext), [
    '-f', '140', '--postprocessor-args', 'ffmpeg_o:-c copy',
  ]);
  for (const format of formats) {
    const args = getFormatArgs(format.formatId, format.ext);
    assert.ok(!args.some(arg => /extract-audio|audio-format|audio-quality|recode-video/.test(arg)));
  }
});

test('preserves MP4 and WebM and distinct video codecs at the same resolution', () => {
  const webm = { ...video, format_id: '248', ext: 'webm', vcodec: 'vp9' };
  const av1 = { ...video, format_id: '399', vcodec: 'av01.0.08M.08' };
  const formats = buildVideoFormats([video, webm, av1, ...audio]).filter(format => format.resolution !== 'Audio');
  assert.equal(formats.length, 3);
  assert.deepEqual(new Set(formats.map(format => format.formatId)), new Set(['137+140', '248+251', '399+140']));
});

test('WebM-only audio is labeled WebM and merged with WebM video', () => {
  const webmVideo = { ...video, format_id: '248', ext: 'webm', vcodec: 'vp9' };
  const formats = buildVideoFormats([webmVideo, audio[1]]);
  assert.equal(formats[0].formatId, '248+251');
  assert.equal(formats[0].ext, 'webm');
  assert.equal(formats[1].ext, 'webm');
  assert.match(formats[1].qualityLabel, /^WEBM/);
});

test('mixed containers use MKV without re-encoding', () => {
  const format = buildVideoFormats([video, audio[1]])[0];
  assert.equal(format.ext, 'mkv');
  assert.deepEqual(getFormatArgs(format.formatId, format.ext), ['-f', '137+251', '--postprocessor-args', 'ffmpeg_o:-c copy', '--merge-output-format', 'mkv']);
});

test('does not offer silent videos or DRM streams', () => {
  assert.deepEqual(buildVideoFormats([video]), []);
  assert.deepEqual(buildVideoFormats([{ ...video, has_drm: true }, { ...audio[0], has_drm: true }]), []);
});

test('combined streams download directly and unknown audio size stays unknown', () => {
  const direct = { ...video, format_id: '18', acodec: 'mp4a.40.2' };
  const format = buildVideoFormats([direct])[0];
  assert.equal(format.formatId, '18');
  assert.equal(format.filesize, 10000);
  assert.deepEqual(getFormatArgs(format.formatId, format.ext), ['-f', '18', '--postprocessor-args', 'ffmpeg_o:-c copy']);
  assert.equal(buildVideoFormats([video, { ...audio[0], filesize: undefined }])[0].filesize, null);
});

test('rejects legacy conversion requests and implicit format selectors', () => {
  for (const selector of ['bestaudio_mp3', '1080p', 'bestaudio', '137+bestaudio', '137/18']) {
    assert.throws(() => getFormatArgs(selector, 'mp3'), /conversion is disabled/);
  }
});

test('supports original MP3 only when the source actually provides it', () => {
  const formats = buildVideoFormats([{ ...audio[0], format_id: '999', ext: 'mp3', acodec: 'mp3' }]);
  assert.equal(formats[0].ext, 'mp3');
  assert.deepEqual(getFormatArgs(formats[0].formatId, 'mp3'), [
    '-f', '999', '--postprocessor-args', 'ffmpeg_o:-c copy',
  ]);
});

test('reads padded progress columns and unknown download speeds', () => {
  assert.deepEqual(parseDownloadProgress(' 65.6% of   27.11MiB at    1.90MiB/s ETA 00:04'), {
    percent: 65.6, speed: '1.90MiB/s', eta: '00:04',
  });
  assert.deepEqual(parseDownloadProgress(' 0.0% of ~ 27.11MiB at Unknown speed ETA 01:00'), {
    percent: 0, speed: 'Unknown speed', eta: '01:00',
  });
  assert.equal(parseDownloadProgress('Destination: file.mp4'), null);
});
