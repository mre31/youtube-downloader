import { createHash, timingSafeEqual } from 'node:crypto';

function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** Fail closed for the external API when the server token is absent. */
export function authenticationError(request: Request): Response | null {
  const token = process.env.API_TOKEN?.trim();
  const fail = (status: number, code: string, message: string) => {
    return Response.json({ error: { code, message } }, {
      status, headers: { 'Cache-Control': 'no-store',
        ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="downloader"' } : {}) },
    });
  };
  if (!token) return fail(503, 'AUTH_NOT_CONFIGURED', 'Set API_TOKEN on the server to enable the external API.');
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const bearer = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
    return bearer && equal(bearer, token) ? null : fail(401, 'UNAUTHORIZED', 'A valid Bearer token is required.');
  }
  return fail(401, 'UNAUTHORIZED', 'A valid Bearer token is required.');
}
