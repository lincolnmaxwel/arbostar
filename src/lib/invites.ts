import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { appBaseUrl } from '@/lib/emailLayout';

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function inviteUrl(token: string): string {
  return `${appBaseUrl()}/invite/${token}`;
}

export type InviteLookup =
  | { state: 'valid'; invite: NonNullable<Awaited<ReturnType<typeof findInvite>>> }
  | { state: 'invalid' | 'expired' | 'used' };

function findInvite(tokenHash: string) {
  return prisma.userInvite.findUnique({ where: { tokenHash } });
}

/** Resolve a raw token from the URL into a usable invite (or why not). */
export async function lookupInvite(token: string): Promise<InviteLookup> {
  if (!token || token.length < 20 || token.length > 100) return { state: 'invalid' };
  const invite = await findInvite(hashInviteToken(token));
  if (!invite) return { state: 'invalid' };
  if (invite.acceptedAt) return { state: 'used' };
  if (invite.expiresAt.getTime() <= Date.now()) return { state: 'expired' };
  return { state: 'valid', invite };
}
