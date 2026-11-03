import { NextResponse, type NextRequest } from 'next/server';
import { authenticationError } from '@/lib/api-auth';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/api/health' || path === '/api/auth') return NextResponse.next();
  return authenticationError(request, !path.startsWith('/api/v1/')) || NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
