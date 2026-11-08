import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { appBaseUrl } from '@/lib/emailLayout';

/** How long a sign-up verification link stays valid. */
export const SIGNUP_TTL_HOURS = 24;
/** One verification email per address at most once per this window. */
export const SIGNUP_COOLDOWN_MINUTES = 10;

export function generateSignupToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSignupToken(token) };
}

export function hashSignupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signupExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SIGNUP_TTL_HOURS * 60 * 60 * 1000);
}

export function signupVerifyUrl(token: string): string {
  return `${appBaseUrl()}/signup/verify/${token}`;
}

export type SignupLookup =
  | { state: 'valid'; signup: NonNullable<Awaited<ReturnType<typeof findSignup>>> }
  | { state: 'invalid' | 'expired' | 'used' };

function findSignup(tokenHash: string) {
  return prisma.pendingSignup.findUnique({ where: { tokenHash } });
}

/** Resolve a raw token from the URL into a usable sign-up (or why not). */
export async function lookupSignup(token: string): Promise<SignupLookup> {
  if (!token || token.length < 20 || token.length > 100) return { state: 'invalid' };
  const signup = await findSignup(hashSignupToken(token));
  if (!signup) return { state: 'invalid' };
  if (signup.acceptedAt || signup.emailVerifiedAt) return { state: 'used' };
  if (signup.expiresAt.getTime() <= Date.now()) return { state: 'expired' };
  return { state: 'valid', signup };
}

/** Minimum words in the "how did you hear about us" answer. */
export const REFERRAL_MIN_WORDS = 3;
export const REFERRAL_MAX_LENGTH = 300;

export function referralWordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Returns an error message, or null when the answer is acceptable. */
export function referralProblem(value: string): string | null {
  if (referralWordCount(value) < REFERRAL_MIN_WORDS) {
    return `Tell us how you heard about us in at least ${REFERRAL_MIN_WORDS} words (for example, who referred you).`;
  }
  if (value.trim().length > REFERRAL_MAX_LENGTH) {
    return `Keep it under ${REFERRAL_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Phone is stored masked, "(xxx) xxx-xxxx". Returns an error message or null. */
export function phoneProblem(value: string): string | null {
  return value.replace(/\D/g, '').length === 10 ? null : 'Enter a 10-digit phone number.';
}
