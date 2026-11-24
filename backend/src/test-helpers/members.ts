import { getDb } from '../db/connection';
import { builtInRoleId, grantShareRole } from '../permissions/grants';
import type { TestApp } from './http-client';
import { createInvitee, type Invitee } from './invitee';

export interface Members {
  coOwner: Invitee;
  editor: Invitee;
  viewer: Invitee;
  stranger: Invitee;
  disabled: Invitee;
}

export function seedCar(ctx: TestApp, vehicleId: string, ownerId = ctx.user.id): void {
  ctx.sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)",
    [vehicleId, ownerId]
  );
}

export function shareCar(
  ctx: TestApp,
  vehicleId: string,
  member: Invitee,
  level: 'viewer' | 'editor'
): void {
  ctx.sqlite.run(
    "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, ?, 'accepted', ?)",
    [`share-${vehicleId}-${member.id}`, vehicleId, ctx.user.id, member.id, level, member.email]
  );
  grantShareRole(getDb(), { vehicleId, sharedWithId: member.id, level, grantedBy: ctx.user.id });
}

export function overrideOn(
  ctx: TestApp,
  vehicleId: string,
  member: Invitee,
  permission: string,
  effect: 'allow' | 'deny'
): void {
  ctx.sqlite.run(
    "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES (?, ?, 'vehicle', ?, ?, ?)",
    [`po-${member.id}-${permission}`, member.id, vehicleId, permission, effect]
  );
}

export async function seedMembers(
  ctx: TestApp,
  vehicleId: string,
  prefix: string
): Promise<Members> {
  const members: Members = {
    coOwner: await createInvitee(ctx, `${prefix}-co-owner`),
    editor: await createInvitee(ctx, `${prefix}-editor`),
    viewer: await createInvitee(ctx, `${prefix}-viewer`),
    stranger: await createInvitee(ctx, `${prefix}-stranger`),
    disabled: await createInvitee(ctx, `${prefix}-disabled`),
  };
  shareCar(ctx, vehicleId, members.coOwner, 'viewer');
  shareCar(ctx, vehicleId, members.editor, 'editor');
  shareCar(ctx, vehicleId, members.viewer, 'viewer');
  shareCar(ctx, vehicleId, members.disabled, 'editor');
  ctx.sqlite.run(
    'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
    [
      `ra-${members.coOwner.id}`,
      members.coOwner.id,
      builtInRoleId('co_owner'),
      vehicleId,
      ctx.user.id,
    ]
  );
  ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [members.disabled.id]);
  return members;
}
