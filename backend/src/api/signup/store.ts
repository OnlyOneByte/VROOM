import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AppDatabase } from '../../db/connection';
import {
  roleAssignments,
  serverInvites,
  serverSettings,
  users,
  vehicleShares,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { ConflictError, NotFoundError } from '../../errors';
import { assignServerRole, builtInRoleId } from '../../permissions/grants';
import { DEMO_USER_ID } from '../auth/demo-account';
import { isSignupMode, parseDomains, type SignupMode } from './policy';

type Db = AppDatabase | DrizzleTransaction;

const SETTINGS_ROW = 1;

export interface SignupSettings {
  mode: SignupMode;
  modeLocked: boolean;
  allowedDomains: string[];
  domainsLocked: boolean;
}

export function signupSettings(db: Db): SignupSettings {
  const row = db.select().from(serverSettings).where(eq(serverSettings.id, SETTINGS_ROW)).get();
  const stored = row && isSignupMode(row.signupMode) ? row.signupMode : 'invite';
  const envDomains = CONFIG.signup.allowedDomains;
  return {
    mode: CONFIG.signup.mode ?? stored,
    modeLocked: CONFIG.signup.mode !== undefined,
    allowedDomains: parseDomains(envDomains ?? row?.allowedEmailDomains ?? ''),
    domainsLocked: envDomains !== undefined,
  };
}

export function ensureServerSettings(db: Db): void {
  db.insert(serverSettings).values({ id: SETTINGS_ROW }).onConflictDoNothing().run();
}

export function updateSignupSettings(
  db: Db,
  change: { mode?: SignupMode; allowedDomains?: string[] },
  actorId: string
): SignupSettings {
  const current = signupSettings(db);
  if (change.mode !== undefined && current.modeLocked) {
    throw new ConflictError('The sign-up mode is set by SIGNUP_MODE on the server');
  }
  if (change.allowedDomains !== undefined && current.domainsLocked) {
    throw new ConflictError(
      'Allowed email domains are set by SIGNUP_ALLOWED_DOMAINS on the server'
    );
  }
  ensureServerSettings(db);
  db.update(serverSettings)
    .set({
      ...(change.mode !== undefined && { signupMode: change.mode }),
      ...(change.allowedDomains !== undefined && {
        allowedEmailDomains: parseDomains(change.allowedDomains.join(',')).join(','),
      }),
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(eq(serverSettings.id, SETTINGS_ROW))
    .run();
  return signupSettings(db);
}

export function hasRealAccounts(db: Db): boolean {
  return (
    db.select({ id: users.id }).from(users).where(ne(users.id, DEMO_USER_ID)).get() !== undefined
  );
}

export function hasServerAdmin(db: Db): boolean {
  return (
    db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(eq(roleAssignments.roleId, builtInRoleId('admin')), isNull(roleAssignments.scopeId))
      )
      .get() !== undefined
  );
}

export function becomesFirstAdmin(db: Db, email: string): boolean {
  if (hasServerAdmin(db)) return false;
  const listed = CONFIG.adminEmails;
  return listed.length > 0 ? listed.includes(email.toLowerCase()) : !hasRealAccounts(db);
}

export function markAdminAssigned(db: Db, now: Date = new Date()): void {
  ensureServerSettings(db);
  db.update(serverSettings)
    .set({ adminAssignedAt: now })
    .where(and(eq(serverSettings.id, SETTINGS_ROW), isNull(serverSettings.adminAssignedAt)))
    .run();
}

export function ensureServerAdmin(db: Db): string | null {
  const row = db.select().from(serverSettings).where(eq(serverSettings.id, SETTINGS_ROW)).get();
  if (!row || row.adminAssignedAt) return null;
  if (hasServerAdmin(db)) {
    markAdminAssigned(db);
    return null;
  }
  const listed = CONFIG.adminEmails;
  const candidate = db
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
    .get();
  if (!candidate) return null;
  assignServerRole(db, candidate.id, 'admin');
  markAdminAssigned(db);
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

export function activeInviteFor(db: Db, email: string, now: Date) {
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
    .get();
}

export function createInvite(
  db: Db,
  input: { email: string; expiresInDays: number; createdBy: string },
  now: Date = new Date()
) {
  const email = input.email.trim().toLowerCase();
  if (activeInviteFor(db, email, now)) {
    throw new ConflictError('That email already has an open invite');
  }
  return db
    .insert(serverInvites)
    .values({
      email,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000),
    })
    .returning()
    .get();
}

export function listInvites(db: Db) {
  return db.select().from(serverInvites).orderBy(desc(serverInvites.createdAt)).all();
}

export function revokeInvite(db: Db, id: string, now: Date = new Date()) {
  const invite = db.select().from(serverInvites).where(eq(serverInvites.id, id)).get();
  if (!invite) throw new NotFoundError('Invite');
  if (inviteStatus(invite, now) !== 'active') {
    throw new ConflictError('Only an open invite can be revoked');
  }
  return db
    .update(serverInvites)
    .set({ revokedAt: now })
    .where(eq(serverInvites.id, id))
    .returning()
    .get();
}

export function consumeInvite(db: Db, id: string, userId: string, now: Date): void {
  db.update(serverInvites)
    .set({ usedAt: now, usedBy: userId })
    .where(and(eq(serverInvites.id, id), isNull(serverInvites.usedAt)))
    .run();
}

export function hasShareInvite(db: Db, email: string): boolean {
  const row = db
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
    .get();
  return row !== undefined;
}

export function pendingAccounts(db: Db) {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      pendingSince: users.pendingApprovalAt,
    })
    .from(users)
    .where(and(ne(users.id, DEMO_USER_ID), isNotNull(users.pendingApprovalAt)))
    .orderBy(users.pendingApprovalAt)
    .all();
}
