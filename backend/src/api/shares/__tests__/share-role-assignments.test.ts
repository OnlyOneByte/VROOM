import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appContext } from '../../../app-context';
import { builtInRoleId, grantShareRole } from '../../../permissions/grants';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('accepting a share sets the built-in role from its level', () => {
  test('a leftover Editor assignment is replaced when a Viewer share is accepted', async () => {
    const vehicleId = await seedVehicle(ctx);
    const invitee = await createInvitee(ctx, 'stale-editor');
    await grantShareRole(appContext().asyncDb, {
      vehicleId,
      sharedWithId: invitee.id,
      level: 'editor',
      grantedBy: ctx.user.id,
    });

    await invitee.acceptShare(vehicleId, 'viewer');

    const roles = await ctx.sql.all(
      'SELECT role_id FROM role_assignments WHERE user_id = ? AND scope_id = ?',
      [invitee.id, vehicleId]
    );
    expect(roles).toEqual([{ role_id: builtInRoleId('viewer') }]);
  });
});

describe('share transitions read the share inside their transaction', () => {
  async function vehicleRoles(userId: string, vehicleId: string): Promise<unknown[]> {
    return await ctx.sql.all(
      'SELECT role_id FROM role_assignments WHERE user_id = ? AND scope_id = ?',
      [userId, vehicleId]
    );
  }

  test('a racing accept and revoke always leave the status and roles in agreement', async () => {
    const invitee = await createInvitee(ctx, 'racer');
    for (let round = 0; round < 25; round++) {
      const vehicleId = await seedVehicle(ctx, { nickname: `Race ${round}` });
      const invite = await ctx.authed('POST', '/api/v1/shares', {
        vehicleId,
        email: invitee.email,
        level: 'editor',
      });
      const shareId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
      const [accepted, revoked] = await Promise.all([
        invitee.request('POST', `/api/v1/shares/${shareId}/accept`),
        ctx.authed('DELETE', `/api/v1/shares/${shareId}`),
      ]);
      expect([200, 409]).toContain(accepted.status);
      expect([200, 409]).toContain(revoked.status);
      const { status } = (await ctx.sql.get('SELECT status FROM vehicle_shares WHERE id = ?', [
        shareId,
      ])) as { status: string };
      const roles = await vehicleRoles(invitee.id, vehicleId);
      expect(roles).toEqual(status === 'accepted' ? [{ role_id: builtInRoleId('editor') }] : []);
    }
  });

  test('a leftover override does not survive a new accept', async () => {
    const vehicleId = await seedVehicle(ctx);
    const invitee = await createInvitee(ctx, 'stale-override');
    await ctx.sql.run(
      "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES ('stale', ?, 'vehicle', ?, 'vehicle.financing.read', 'allow')",
      [invitee.id, vehicleId]
    );

    await invitee.acceptShare(vehicleId, 'viewer');

    expect(
      await ctx.sql.all('SELECT id FROM permission_overrides WHERE user_id = ?', [invitee.id])
    ).toEqual([]);
    expect(await vehicleRoles(invitee.id, vehicleId)).toEqual([
      { role_id: builtInRoleId('viewer') },
    ]);
  });

  test('a transition on a share that changed underneath answers 409', async () => {
    const vehicleId = await seedVehicle(ctx);
    const invitee = await createInvitee(ctx, 'late-accept');
    const invite = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: invitee.email,
      level: 'viewer',
    });
    const shareId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
    expect((await ctx.authed('DELETE', `/api/v1/shares/${shareId}`)).status).toBe(200);
    expect((await invitee.request('POST', `/api/v1/shares/${shareId}/decline`)).status).toBe(409);
  });
});
