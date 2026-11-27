import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import {
  roleAssignments,
  serverInvites,
  serverSettings,
  users,
  vehicleShares,
} from '../../db/schema';
import { ConflictError, NotFoundError } from '../../errors';
import { assignServerRole, builtInRoleId } from '../../permissions/grants';
import { DEMO_USER_ID } from '../auth/demo-account';
import { isSignupMode, parseDomains, type SignupMode } from './policy';

const SETTINGS_ROW = 1;

export interface SignupSettings {
  mode: SignupMode;
  modeLocked: boolean;
  allowedDomains: string[];
  domainsLocked: boolean;
}

export async function signupSettings(db: AsyncHandle): Promise<SignupSettings> {
  const row = await db
    .select()
    .from(serverSettings)
    .where(eq(serverSettings.id, SETTINGS_ROW))
    .then(firstRow);
  const stored = row && isSignupMode(row.signupMode) ? row.signupMode : 'invite';
  const envDomains = CONFIG.signup.allowedDomains;
  return {
    mode: CONFIG.signup.mode ?? stored,
    modeLocked: CONFIG.signup.mode !== undefined,
    allowedDomains: parseDomains(envDomains ?? row?.allowedEmailDomains ?? ''),
    domainsLocked: envDomains !== undefined,
  };
}

async function ensureServerSettings(db: AsyncHandle): Promise<void> {
  await db.insert(serverSettings).values({ id: SETTINGS_ROW }).onConflictDoNothing();
}

export async function updateSignupSettings(
  tx: AsyncHandle,
  change: { mode?: SignupMode; allowedDomains?: string[] },
  actorId: string
): Promise<SignupSettings> {
  const current = await signupSettings(tx);
  if (change.mode !== undefined && current.modeLocked) {
    throw new ConflictError('The sign-up mode is set by SIGNUP_MODE on the server');
  }
  if (change.allowedDomains !== undefined && current.domainsLocked) {
    throw new ConflictError(
      'Allowed email domains are set by SIGNUP_ALLOWED_DOMAINS on the server'
    );
  }
  await ensureServerSettings(tx);
  await tx
    .update(serverSettings)
    .set({
      ...(change.mode !== undefined && { signupMode: change.mode }),
      ...(change.allowedDomains !== undefined && {
        allowedEmailDomains: parseDomains(change.allowedDomains.join(',')).join(','),
      }),
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(eq(serverSettings.id, SETTINGS_ROW));
  return signupSettings(tx);
}

async function hasRealAccounts(db: AsyncHandle): Promise<boolean> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(ne(users.id, DEMO_USER_ID))
    .then(firstRow);
  return row !== undefined;
}

async function hasServerAdmin(db: AsyncHandle): Promise<boolean> {
  const row = await db
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.roleId, builtInRoleId('admin')), isNull(roleAssignments.scopeId)))
    .then(firstRow);
  return row !== undefined;
}

export async function becomesFirstAdmin(tx: AsyncHandle, email: string): Promise<boolean> {
  if (await hasServerAdmin(tx)) return false;
  const listed = CONFIG.adminEmails;
  return listed.length > 0 ? listed.includes(email.toLowerCase()) : !(await hasRealAccounts(tx));
}

export async function markAdminAssigned(tx: AsyncHandle, now: Date = new Date()): Promise<void> {
  await ensureServerSettings(tx);
  await tx
    .update(serverSettings)
    .set({ adminAssignedAt: now })
    .where(and(eq(serverSettings.id, SETTINGS_ROW), isNull(serverSettings.adminAssignedAt)));
}

export async function ensureServerAdmin(tx: AsyncHandle): Promise<string | null> {
  const row = await tx
    .select()
    .from(serverSettings)
    .where(eq(serverSettings.id, SETTINGS_ROW))
    .then(firstRow);
  if (!row || row.adminAssignedAt) return null;
  if (await hasServerAdmin(tx)) {
    await markAdminAssigned(tx);
    return null;
  }
  const listed = CONFIG.adminEmails;
  const candidate = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        ne(users.id, DEMO_USER_ID),
        isNull(users.disabledAt),
        isNull(users.pendingApprovalAt),
        listed.length > 0 ? inArray(users.email, listed) : undefined
      )
    )
    .orderBy(sql`${users.createdAt} IS NULL`, users.createdAt, users.id)
    .then(firstRow);
  if (!candidate) return null;
  await assignServerRole(tx, candidate.id, 'admin');
  await markAdminAssigned(tx);
  return candidate.id;
}

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

export function inviteStatus(
  invite: Pick<typeof serverInvites.$inferSelect, 'usedAt' | 'revokedAt' | 'expiresAt'>,
  now: Date
): InviteStatus {
  if (invite.usedAt) return 'used';
  if (invite.revokedAt) return 'revoked';
  return invite.expiresAt <= now ? 'expired' : 'active';
}

export function activeInviteFor(db: AsyncHandle, email: string, now: Date) {
  return db
    .select()
    .from(serverInvites)
    .where(
      and(
        eq(serverInvites.email, email.toLowerCase()),
        isNull(serverInvites.usedAt),
        isNull(serverInvites.revokedAt),
        gt(serverInvites.expiresAt, now)
      )
    )
    .then(firstRow);
}

export async function createInvite(
  tx: AsyncHandle,
  input: { email: string; expiresInDays: number; createdBy: string },
  now: Date = new Date()
) {
  const email = input.email.trim().toLowerCase();
  if (await activeInviteFor(tx, email, now)) {
    throw new ConflictError('That email already has an open invite');
  }
  const [invite] = await tx
    .insert(serverInvites)
    .values({
      email,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!invite) throw new Error('Invite insert returned no row');
  return invite;
}

export function listInvites(db: AsyncHandle) {
  return db.select().from(serverInvites).orderBy(desc(serverInvites.createdAt));
}

export async function revokeInvite(tx: AsyncHandle, id: string, now: Date = new Date()) {
  const invite = await tx
    .select()
    .from(serverInvites)
    .where(eq(serverInvites.id, id))
    .then(firstRow);
  if (!invite) throw new NotFoundError('Invite');
  if (inviteStatus(invite, now) !== 'active') {
    throw new ConflictError('Only an open invite can be revoked');
  }
  const [revoked] = await tx
    .update(serverInvites)
    .set({ revokedAt: now })
    .where(eq(serverInvites.id, id))
    .returning();
  if (!revoked) throw new NotFoundError('Invite');
  return revoked;
}

export async function consumeInvite(
  tx: AsyncHandle,
  id: string,
  userId: string,
  now: Date
): Promise<void> {
  await tx
    .update(serverInvites)
    .set({ usedAt: now, usedBy: userId })
    .where(and(eq(serverInvites.id, id), isNull(serverInvites.usedAt)));
}

export async function hasShareInvite(db: AsyncHandle, email: string): Promise<boolean> {
  const row = await db
    .select({ id: vehicleShares.id })
    .from(vehicleShares)
    .innerJoin(users, eq(users.id, vehicleShares.ownerId))
    .where(
      and(
        eq(vehicleShares.invitedEmail, email.toLowerCase()),
        eq(vehicleShares.status, 'pending'),
        isNull(vehicleShares.sharedWithId),
        isNull(users.disabledAt),
        isNull(users.pendingApprovalAt),
        ne(users.id, DEMO_USER_ID)
      )
    )
    .then(firstRow);
  return row !== undefined;
}

export function pendingAccounts(db: AsyncHandle) {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      pendingSince: users.pendingApprovalAt,
    })
    .from(users)
    .where(and(ne(users.id, DEMO_USER_ID), isNotNull(users.pendingApprovalAt)))
    .orderBy(users.pendingApprovalAt);
}
