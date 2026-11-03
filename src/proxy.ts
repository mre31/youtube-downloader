import { NextResponse, type NextRequest } from 'next/server';
import { authenticationError } from '@/lib/api-auth';

export function proxy(request: NextRequest) {
  return authenticationError(request) || NextResponse.next();
}

export const config = { matcher: '/api/v1/:path*' };
