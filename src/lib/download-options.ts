export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string;
  qualityLabel: string;
  filesize: number | null;
  vcodec: string;
  acodec: string;
  fps?: number;
  tbr?: number;
}

export interface SourceFormat {
  format_id: string;
  ext: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
  has_drm?: boolean;
  protocol?: string;
}

const sizeOf = (format: SourceFormat) => format.filesize || format.filesize_approx || null;
const hasAudio = (format: SourceFormat) => !!format.acodec && format.acodec !== 'none';
const bestAudioOf = (formats: SourceFormat[]) => [...formats].sort(
  (a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0) ||
    Number(a.format_id.endsWith('-drc')) - Number(b.format_id.endsWith('-drc'))
)[0];

export function codecLabel(codec: string): string {
  if (/^(avc|h264)/i.test(codec)) return 'H.264';
  if (/^(av01|av1)/i.test(codec)) return 'AV1';
  if (/^(vp09|vp9)/i.test(codec)) return 'VP9';
  if (/^(hev|hvc|hevc)/i.test(codec)) return 'HEVC';
  if (/^(mp4a|aac)/i.test(codec)) return 'AAC';
  if (/^opus/i.test(codec)) return 'Opus';
  if (/^vorbis/i.test(codec)) return 'Vorbis';
  return codec === 'none' ? '' : codec.toUpperCase();
}

export function buildVideoFormats(rawFormats: SourceFormat[]): VideoFormat[] {
  const available = rawFormats.filter(format => !format.has_drm);
  const audioFormats = available.filter(format => hasAudio(format) && format.vcodec === 'none');
  const bestAudio = bestAudioOf(audioFormats);
  const m4aAudio = bestAudioOf(audioFormats.filter(format =>
    format.ext === 'm4a' && /^(mp4a|aac)/.test(format.acodec || '')
  ));
  const webmAudio = bestAudioOf(audioFormats.filter(format =>
    format.ext === 'webm' && /^(opus|vorbis)/.test(format.acodec || '')
  ));
  const videoChoices = new Map<string, { format: VideoFormat; source: SourceFormat }>();
  const sourcePreference = (source: SourceFormat) => ['https', 'http'].includes(source.protocol || '') ? 1 : 0;

  for (const video of available) {
    if (!video.height || !video.vcodec || video.vcodec === 'none') continue;
    const audio = hasAudio(video) ? undefined :
      (video.ext === 'mp4' ? m4aAudio : video.ext === 'webm' ? webmAudio : undefined) || bestAudio;
    if (!hasAudio(video) && !audio) continue;
    // Containers can change during a stream-copy merge; the codecs never change.
    const ext = !audio ? video.ext :
      video.ext === 'mp4' && audio.ext === 'm4a' ? 'mp4' :
      video.ext === 'webm' && audio.ext === 'webm' ? 'webm' : 'mkv';
    const videoSize = sizeOf(video);
    const audioSize = audio ? sizeOf(audio) : 0;
    const format: VideoFormat = {
      formatId: audio ? `${video.format_id}+${audio.format_id}` : video.format_id,
      ext,
      resolution: `${video.height}p`,
      qualityLabel: `${video.height}p (${ext.toUpperCase()})`,
      filesize: videoSize && audioSize !== null ? videoSize + audioSize : null,
      vcodec: video.vcodec,
      acodec: audio?.acodec || video.acodec || 'none',
      fps: video.fps,
      tbr: video.tbr,
    };
    // Keep each container/codec/fps choice at every resolution, deduplicating transports.
    const key = [video.height, ext, codecLabel(format.vcodec), codecLabel(format.acodec), video.fps || 0].join(':');
    const existing = videoChoices.get(key);
    if (!existing || sourcePreference(video) > sourcePreference(existing.source) ||
      (sourcePreference(video) === sourcePreference(existing.source) && (video.tbr || 0) > (existing.source.tbr || 0))) {
      videoChoices.set(key, { format, source: video });
    }
  }

  const containerOrder = (ext: string) => ext === 'mp4' ? 0 : ext === 'webm' ? 1 : 2;
  const formats = [...videoChoices.values()].map(({ format }) => format).sort((a, b) =>
    Number.parseInt(b.resolution) - Number.parseInt(a.resolution) ||
    containerOrder(a.ext) - containerOrder(b.ext) ||
    (b.fps || 0) - (a.fps || 0) || a.vcodec.localeCompare(b.vcodec)
  );
  const audioGroups = new Map<string, SourceFormat[]>();
  for (const audio of audioFormats) {
    const key = `${audio.ext}:${codecLabel(audio.acodec || '')}`;
    const group = audioGroups.get(key) || [];
    group.push(audio);
    audioGroups.set(key, group);
  }
  const nativeAudioChoices = [...audioGroups.values()].map(group => bestAudioOf(group))
    .sort((a, b) => containerOrder(a.ext === 'm4a' ? 'mp4' : a.ext) - containerOrder(b.ext === 'm4a' ? 'mp4' : b.ext));
  for (const audio of nativeAudioChoices) {
    const bitrate = Math.round(audio.abr || audio.tbr || 0);
    formats.push({
      formatId: audio.format_id,
      ext: audio.ext,
      resolution: 'Audio',
      qualityLabel: `${audio.ext.toUpperCase()} · ${codecLabel(audio.acodec || '')}${bitrate ? ` · ${bitrate} kbps` : ''}`,
      filesize: sizeOf(audio),
      vcodec: 'none',
      acodec: audio.acodec || 'none',
    });
  }
  return formats;
}

export function getFormatArgs(formatId: string, ext: string): string[] {
  // Only explicit YouTube stream IDs are accepted. Old conversion requests and
  // automatic selectors must fail instead of silently choosing a different file.
  if (!/^\d+(?:[-.]\w+)*(?:\+\d+(?:[-.]\w+)*)?$/.test(formatId)) {
    throw new Error('Choose an available original format. Audio/video conversion is disabled.');
  }
  if (!['mp4', 'webm', 'mkv', 'm4a', 'mp3', 'opus', 'ogg', 'aac', 'flac', 'wav'].includes(ext)) {
    throw new Error('Unsupported media container');
  }
  const args = ['-f', formatId, '--postprocessor-args', 'ffmpeg_o:-c copy'];
  if (formatId.includes('+')) {
    if (!['mp4', 'webm', 'mkv'].includes(ext)) throw new Error('Unsupported merge container');
    args.push('--merge-output-format', ext);
  }
  return args;
}

export function parseDownloadProgress(line: string) {
  // yt-dlp pads size/speed columns; the wrapper's parser expects single spaces.
  const match = line.match(/([\d.]+)%\s+of\s+~?\s*\S+\s+at\s+(.+?)\s+ETA\s+([\d:]+)/);
  return match ? { percent: Number.parseFloat(match[1]), speed: match[2].trim(), eta: match[3] } : null;
}
