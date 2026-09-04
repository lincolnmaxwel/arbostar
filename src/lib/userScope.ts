import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const VIEW_AS_COOKIE_NAME = 'arbostar-view-as-user';

export type UserScope = {
  /** Real logged-in user. */
  actorUserId: string;
  /** Data owner being queried/written (the viewed user while view-as is active). */
  ownerUserId: string;
  isViewAs: boolean;
  targetUserId?: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden');
  }
}

/**
 * Require a real admin session (the actual logged-in actor, never the
 * effective view-as owner). Returns the actor's id. Throws UnauthorizedError
 * when not authenticated and ForbiddenError for staff sessions.
 */
export async function requireAdminSession(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new UnauthorizedError();

  const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!actor || actor.status !== 'active' || actor.role !== 'admin') throw new ForbiddenError();
  return actor.id;
}

/**
 * Audit an administrative action (create/update user, feature toggle, view-as
 * entry/exit, etc.). Admin actions are logged with the real admin as actor,
 * independent of any view-as scope.
 */
export async function auditAdminAction(
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
) {
  await prisma.auditLog.create({ data: { entityType, entityId, action, actorId } });
}

/**
 * Resolve the effective data scope for an authenticated request: the real
 * session, the actor's current role/status, and the validated view-as cookie.
 * Only an active-session admin may use view-as; staff sessions ignore (and
 * effectively clear) any stale cookie. Rejects a non-active actor.
 *
 * When `Tenant` exists, this scope also gains `tenantId`.
 */
export async function requireUserScope(): Promise<UserScope> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new UnauthorizedError();

  const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!actor || actor.status !== 'active') throw new UnauthorizedError();

  const store = cookies();
  const viewAsUserId = store.get(VIEW_AS_COOKIE_NAME)?.value;

  if (viewAsUserId && actor.role === 'admin') {
    const target = await prisma.user.findUnique({ where: { id: viewAsUserId } });
    if (target) {
      return {
        actorUserId: actor.id,
        ownerUserId: target.id,
        isViewAs: true,
        targetUserId: target.id,
      };
    }
  }

  return { actorUserId: actor.id, ownerUserId: actor.id, isViewAs: false };
}

/**
 * Record an AuditLog row for mutations performed while an admin views another
 * user. Plain (non-view-as) mutations are not audited by this helper.
 */
export async function auditScopedMutation(
  scope: UserScope,
  entityType: string,
  entityId: string,
  action: string,
) {
  if (!scope.isViewAs) return;
  await prisma.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      actorId: scope.actorUserId,
      targetUserId: scope.ownerUserId,
    },
  });
}