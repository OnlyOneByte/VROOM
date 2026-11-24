import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../../../db/connection';
import { builtInRoleId, grantShareRole } from '../../../permissions/grants';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('accepting a share sets the built-in role from its level', () => {
  test('a leftover Editor assignment is replaced when a Viewer share is accepted', async () => {
    const vehicleId = await seedVehicle(ctx);
    const invitee = await createInvitee(ctx, 'stale-editor');
    grantShareRole(getDb(), {
      vehicleId,
      sharedWithId: invitee.id,
      level: 'editor',
      grantedBy: ctx.user.id,
    });

    await invitee.acceptShare(vehicleId, 'viewer');

    const roles = ctx.sqlite
      .query('SELECT role_id FROM role_assignments WHERE user_id = ? AND scope_id = ?')
      .all(invitee.id, vehicleId);
    expect(roles).toEqual([{ role_id: builtInRoleId('viewer') }]);
  });
});
