import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let asB: RequestFn;
let bId: string;
let bEmail: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'expw-invitee', 'Editor B');
  bId = b.id;
  bEmail = b.email;
  asB = b.request;
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  vehicleId: string;
  expenseAmount: number;
  description: string | null;
}

async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
  expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
  const acc = await asB('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
  expect(acc.status, 'B accepts the invite').toBe(200);
  return vehicleId;
}

async function storedRow(
  expenseId: string
): Promise<{ user_id: string; created_by: string | null }> {
  return (await ctx.sql.get('SELECT user_id, created_by FROM expenses WHERE id = ?', [
    expenseId,
  ])) as { user_id: string; created_by: string | null };
}

describe('shared expense writes stamp the owner and createdBy', () => {
  test('an EDITOR create stamps userId=OWNER and createdBy=editor (rides the owner books)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 50,
      date: '2024-06-01T00:00:00.000Z',
      description: 'oil change by editor',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = await storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBe(bId);

    const ownerList = await json<DataEnvelope<ExpenseRow[]>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(ownerList.data.find((e) => e.id === body.data.id)).toBeDefined();
  });

  test('an OWNER create on their own vehicle is unchanged: userId=self, createdBy=NULL (self sentinel)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = await storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull();
  });

  test('a forged createdBy in the OWNER create body is IGNORED (stays NULL, not the forged id)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-08T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = await storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull();
  });

  test('a forged createdBy in an EDITOR create body is IGNORED (stamped the acting editor, not the forged id)', async () => {
    const vehicleId = await shareAccepted('editor');
    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-09T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = await storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBe(bId);
  });

  test('an editor can PUT any cost row on the shared vehicle but DELETE only their own', async () => {
    const vehicleId = await shareAccepted('editor');
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 30,
      date: '2024-06-03T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    const putBody = await json<DataEnvelope<{ expenseAmount: number }>>(put);
    expect(put.status, JSON.stringify(putBody)).toBe(200);
    expect(putBody.data.expenseAmount).toBe(99);
    expect((await storedRow(id)).user_id).toBe(ctx.user.id);

    const ownersRow = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(ownersRow.status, "editor cannot delete the owner's expense").toBe(403);
    expect(await ctx.sql.get('SELECT id FROM expenses WHERE id = ?', [id])).not.toBeNull();

    const mine = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-04T00:00:00.000Z',
    });
    const mineId = (await json<DataEnvelope<{ id: string }>>(mine)).data.id;
    const del = await asB('DELETE', `/api/v1/expenses/${mineId}`);
    expect(del.status, 'editor can delete an expense they added').toBe(200);
    expect(await ctx.sql.get('SELECT id FROM expenses WHERE id = ?', [mineId])).toBeNull();
  });

  test('a VIEWER cannot create/update/delete on the shared vehicle it can see (403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-04T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const create = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-06-05T00:00:00.000Z',
    });
    expect(create.status, 'viewer create denied').toBe(403);
    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 1 });
    expect(put.status, 'viewer update denied').toBe(403);
    const del = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(del.status, 'viewer delete denied').toBe(403);

    expect(((await storedRow(id)) as { user_id: string }).user_id).toBe(ctx.user.id);
    const stillAmount = (await ctx.sql.get('SELECT expense_amount FROM expenses WHERE id = ?', [
      id,
    ])) as { expense_amount: number };
    expect(stillAmount.expense_amount).toBe(2000);
  });

  test('an editor cannot reassign a shared expense onto a vehicle owned by a DIFFERENT user', async () => {
    const sharedVehicle = await shareAccepted('editor');
    const bVehicle = (
      await json<DataEnvelope<{ id: string }>>(
        await asB('POST', '/api/v1/vehicles', { make: 'Bcar', model: 'X', year: 2020 })
      )
    ).data.id;
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: sharedVehicle,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-06T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const move = await asB('PUT', `/api/v1/expenses/${id}`, { vehicleId: bVehicle });
    expect(move.status, 'cross-owner reassignment rejected').toBeGreaterThanOrEqual(400);
    expect(move.status).toBeLessThan(500);
    const row = await storedRow(id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(
      (
        (await ctx.sql.get('SELECT vehicle_id FROM expenses WHERE id = ?', [id])) as {
          vehicle_id: string;
        }
      ).vehicle_id
    ).toBe(sharedVehicle);
  });
});

describe('a create replay is scoped to the request vehicle', () => {
  test('an editor replay that matches an expense on another vehicle is refused with no row data', async () => {
    const sharedId = await shareAccepted('editor');
    const privateId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2020 });
    const saved = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: privateId,
      category: 'maintenance',
      expenseAmount: 75,
      date: '2024-06-01T00:00:00.000Z',
      description: 'owner-only note',
      clientId: 'scope-key-1',
    });
    const savedBody = await json<DataEnvelope<{ id: string }>>(saved);
    expect(saved.status, JSON.stringify(savedBody)).toBe(201);

    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId: sharedId,
      category: 'maintenance',
      expenseAmount: 1,
      date: '2024-06-01T00:00:00.000Z',
      clientId: 'scope-key-1',
    });
    const text = await res.text();

    expect(res.status).toBe(409);
    expect(text).not.toContain(savedBody.data.id);
    expect(text).not.toContain(privateId);
    expect(text).not.toContain('owner-only note');
    const count = (await ctx.sql.get(
      "SELECT COUNT(*) AS n FROM expenses WHERE client_id = 'scope-key-1'"
    )) as { n: number };
    expect(count.n).toBe(1);
  });

  test('a replay on the same vehicle still returns the saved row', async () => {
    const sharedId = await shareAccepted('editor');
    const body = {
      vehicleId: sharedId,
      category: 'maintenance',
      expenseAmount: 20,
      date: '2024-06-01T00:00:00.000Z',
      clientId: 'scope-key-2',
    };
    const first = await json<DataEnvelope<{ id: string }>>(
      await asB('POST', '/api/v1/expenses', body)
    );
    const again = await asB('POST', '/api/v1/expenses', body);
    const againBody = await json<DataEnvelope<{ id: string }>>(again);

    expect(again.status).toBe(201);
    expect(againBody.data.id).toBe(first.data.id);
  });
});
