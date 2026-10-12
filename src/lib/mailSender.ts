import { prisma } from '@/lib/db';

/**
 * Who a client-facing email appears to come from. The envelope sender stays
 * the platform address (MAIL_FROM_ADDRESS); the display name is the owner's
 * company and replies go to the owner's own address.
 */
export interface MailSender {
  fromName?: string;
  replyTo?: string;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function mailSenderFromProfile(profile: { name?: string | null; email?: string | null }): MailSender {
  const replyTo = profile.email?.trim();
  return {
    fromName: profile.name?.trim() || undefined,
    replyTo: replyTo && EMAIL_RE.test(replyTo) ? replyTo : undefined,
  };
}

/** Read-only: never creates a profile row just to send an email. */
export async function getMailSender(ownerUserId: string): Promise<MailSender> {
  const profile = await prisma.companyProfile.findUnique({ where: { userId: ownerUserId } });
  return profile ? mailSenderFromProfile(profile) : {};
}
