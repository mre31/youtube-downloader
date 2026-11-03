import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'downloader_session';
export const SESSION_SECONDS = 8 * 60 * 60;

function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function signature(expires: string, token: string): string {
  return createHmac('sha256', token).update(`browser-session:${expires}`).digest('hex');
}

export function createSession(token: string, now = Date.now()): string {
  const expires = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${expires}.${signature(expires, token)}`;
}

export function validSession(value: string, token: string, now = Date.now()): boolean {
  const [expires, mac, extra] = value.split('.');
  if (extra !== undefined || !/^\d+$/.test(expires) || !mac ||
    Number(expires) <= Math.floor(now / 1000) || Number(expires) > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  return equal(mac, signature(expires, token));
}

/** Fail closed when the server token is absent. Browser cookies never authorize v1. */
export function authenticationError(request: Request, allowSession = false): Response | null {
  const token = process.env.API_TOKEN?.trim();
  const fail = (status: number, code: string, message: string) => {
    const path = new URL(request.url).pathname;
    const legacy = !path.startsWith('/api/v1/') && path !== '/api/auth';
    return Response.json({ error: legacy ? message : { code, message } }, {
      status, headers: { 'Cache-Control': 'no-store',
        ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="downloader"' } : {}) },
    });
  };
  if (!token) return fail(503, 'AUTH_NOT_CONFIGURED', 'Set API_TOKEN on the server to enable downloads.');
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const bearer = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
    return bearer && equal(bearer, token) ? null : fail(401, 'UNAUTHORIZED', 'A valid Bearer token is required.');
  }
  if (allowSession) {
    const cookie = request.headers.get('cookie')?.split(';')
      .map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (cookie && validSession(cookie, token)) return null;
  }
  return fail(401, 'UNAUTHORIZED', 'A valid Bearer token is required.');
}
