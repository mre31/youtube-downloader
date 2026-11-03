import type { VideoFormat } from './download-options';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function youtubeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new ApiError(400, 'INVALID_URL', 'A valid YouTube URL is required.');
  }
  let url: URL;
  try { url = new URL(value.trim()); } catch {
    throw new ApiError(400, 'INVALID_URL', 'A valid YouTube URL is required.');
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.port || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    throw new ApiError(400, 'INVALID_URL', 'Only YouTube video URLs are supported.');
  }
  const id = host.endsWith('youtu.be') ? url.pathname.slice(1) :
    url.pathname === '/watch' ? url.searchParams.get('v') :
      /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new ApiError(400, 'INVALID_URL', 'The URL must identify a single YouTube video.');
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

export async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

export function downloadOptions(body: Record<string, unknown>) {
  const allowed = ['url', 'type', 'maxHeight', 'formatId', 'ext'];
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ApiError(400, 'INVALID_OPTIONS', `Supported fields: ${allowed.join(', ')}.`);
  }
  const url = youtubeUrl(body.url);
  const type = body.type ?? 'video';
  if (type !== 'video' && type !== 'audio') {
    throw new ApiError(400, 'INVALID_OPTIONS', 'type must be video or audio.');
  }
  if (body.maxHeight !== undefined && (type === 'audio' ||
    typeof body.maxHeight !== 'number' || !Number.isInteger(body.maxHeight) || body.maxHeight < 1 || body.maxHeight > 8640)) {
    throw new ApiError(400, 'INVALID_OPTIONS', 'maxHeight must be an integer between 1 and 8640, for video only.');
  }
  if ((body.formatId === undefined) !== (body.ext === undefined) ||
    (body.formatId !== undefined && (typeof body.formatId !== 'string' || !body.formatId || typeof body.ext !== 'string' || !body.ext))) {
    throw new ApiError(400, 'INVALID_OPTIONS', 'formatId and ext must be provided together as nonempty strings.');
  }
  return { url, type, maxHeight: body.maxHeight as number | undefined,
    formatId: body.formatId as string | undefined, ext: body.ext as string | undefined };
}

export function selectFormat(formats: VideoFormat[], options: ReturnType<typeof downloadOptions>): VideoFormat {
  const choices = formats.filter(format =>
    (options.type === 'audio' ? format.vcodec === 'none' : format.vcodec !== 'none') &&
    (options.maxHeight === undefined || Number.parseInt(format.resolution) <= options.maxHeight) &&
    (options.formatId === undefined || (format.formatId === options.formatId && format.ext === options.ext))
  );
  choices.sort((a, b) => options.type === 'audio' ?
    (b.tbr || 0) - (a.tbr || 0) :
    Number.parseInt(b.resolution) - Number.parseInt(a.resolution) ||
    (b.fps || 0) - (a.fps || 0) || (b.tbr || 0) - (a.tbr || 0));
  if (!choices.length) throw new ApiError(422, 'FORMAT_UNAVAILABLE', 'No original format matches the requested options.');
  return choices[0];
}

export function apiError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: { code: error.code, message: error.message } },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  console.error('External API error:', error);
  return Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'Unable to process the video. Check server logs and try again.' } },
    { status: 502, headers: { 'Cache-Control': 'no-store' } });
}
