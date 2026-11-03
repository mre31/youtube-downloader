import { NextResponse } from 'next/server';
import { authenticationError, createSession, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return authenticationError(request, true) || Response.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export function POST(request: Request) {
  const denied = authenticationError(request);
  if (denied) return denied;
  const response = NextResponse.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, createSession(process.env.API_TOKEN!.trim()), {
    httpOnly: true, sameSite: 'strict', path: '/api', maxAge: SESSION_SECONDS,
    secure: new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/api', maxAge: 0 });
  return response;
}
