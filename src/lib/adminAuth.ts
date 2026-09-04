import { NextResponse } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/userScope';

/**
 * Shared 401/403 mapping for admin-route auth failures. Lives outside any
 * route file because Next.js route modules may only export route handlers
 * and documented route config symbols.
 */
export function adminAuthErrorResponse(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }
  throw err;
}