import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { appBaseUrl } from '@/lib/emailLayout';

/** A user can be sent a reset email at most once per this window. */
export const RESET_COOLDOWN_MINUTES = 30;
/** How long a reset link stays valid. */
export const RESET_TTL_MINUTES = 60;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function resetUrl(token: string): string {
  return `${appBaseUrl()}/reset-password/${token}`;
}

export type ResetLookup =
  | { state: 'valid'; reset: { id: string; userId: string; email: string; name: string } }
  | { state: 'invalid' | 'expired' | 'used' };

/** Resolve a raw token from the URL into a usable reset (or why not). */
export async function lookupReset(token: string): Promise<ResetLookup> {
  if (!token || token.length < 20 || token.length > 100) return { state: 'invalid' };
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, email: true, name: true, status: true } } },
  });
  if (!row) return { state: 'invalid' };
  if (row.usedAt) return { state: 'used' };
  if (row.expiresAt.getTime() <= Date.now()) return { state: 'expired' };
  if (row.user.status !== 'active') return { state: 'invalid' };
  return { state: 'valid', reset: { id: row.id, userId: row.user.id, email: row.user.email, name: row.user.name } };
}
