import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { overrideOn, seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
let viewer: Invitee;
let editor: Invitee;

const CAR = 'srv-car';
const JUNE = 1717200000;
const RUNNING = 'srv-running';
const RESTRICTED = 'srv-restricted';

function reminder(id: string, category: string): void {
  ctx.sqlite.run(
    "INSERT INTO reminders (id, user_id, name, type, frequency, start_date, next_due_date, expense_category, expense_amount) VALUES (?, ?, ?, 'expense', 'monthly', ?, ?, ?, 5000)",
    [id, ctx.user.id, `Reminder ${id}`, JUNE, JUNE + 86_400 * 30, category]
  );
  ctx.sqlite.run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
    id,
    CAR,
  ]);
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  reminder(RUNNING, 'maintenance');
  reminder(RESTRICTED, 'financial');
  viewer = await createInvitee(ctx, 'srv-viewer');
  editor = await createInvitee(ctx, 'srv-editor');
  await shareCar(ctx, CAR, viewer, 'viewer');
  await shareCar(ctx, CAR, editor, 'editor');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function listed(request: RequestFn): Promise<string[]> {
  const res = await request('GET', `/api/v1/reminders?vehicleId=${CAR}`);
  expect(res.status).toBe(200);
  const rows = (await json<DataEnvelope<Array<{ id?: string; reminder?: { id: string } }>>>(res))
    .data;
  return rows.map((r) => r.reminder?.id ?? r.id ?? '').sort();
}

describe('reminders of a shared car follow the share settings', () => {
  test('a viewer without the relevant access sees only the reminders the share allows', async () => {
    expect(await listed(viewer.request)).toEqual([RUNNING]);
  });

  test('a viewer with that access sees every reminder', async () => {
    await overrideOn(ctx, CAR, viewer, 'vehicle.financing.read', 'allow');
    await overrideOn(ctx, CAR, viewer, 'vehicle.insurance.read', 'allow');
    expect(await listed(viewer.request)).toEqual([RESTRICTED, RUNNING].sort());
  });

  test('the owner sees every reminder', async () => {
    expect(await listed(ctx.authed)).toEqual([RESTRICTED, RUNNING].sort());
  });

  test('an editor without that access cannot change, service or delete a hidden reminder', async () => {
    const put = await editor.request('PUT', `/api/v1/reminders/${RESTRICTED}`, { name: 'Changed' });
    expect(put.status).toBe(404);
    const serviced = await editor.request('POST', `/api/v1/reminders/${RESTRICTED}/mark-serviced`);
    expect(serviced.status).toBe(404);
    ctx.sqlite.run('UPDATE reminders SET created_by = ? WHERE id = ?', [editor.id, RESTRICTED]);
    const removed = await editor.request('DELETE', `/api/v1/reminders/${RESTRICTED}`);
    expect(removed.status).toBe(404);

    const row = ctx.sqlite.query('SELECT name FROM reminders WHERE id = ?').get(RESTRICTED) as {
      name: string;
    } | null;
    expect(row?.name).toBe(`Reminder ${RESTRICTED}`);

    const ok = await editor.request('PUT', `/api/v1/reminders/${RUNNING}`, { name: 'Changed' });
    expect(ok.status).toBe(200);
  });

  test('an editor without that access cannot turn a reminder into a hidden one or create one', async () => {
    const moved = await editor.request('PUT', `/api/v1/reminders/${RUNNING}`, {
      expenseCategory: 'financial',
    });
    expect(moved.status).toBe(404);
    const row = ctx.sqlite
      .query('SELECT expense_category AS category FROM reminders WHERE id = ?')
      .get(RUNNING) as { category: string };
    expect(row.category).toBe('maintenance');

    const created = await editor.request('POST', '/api/v1/reminders', {
      name: 'New',
      type: 'expense',
      frequency: 'monthly',
      startDate: new Date(JUNE * 1000).toISOString(),
      expenseCategory: 'financial',
      expenseAmount: 50,
      vehicleIds: [CAR],
    });
    expect(created.status).toBe(404);
  });

  test('a reminder on two shared cars stays hidden until the viewer has access on both', async () => {
    const SECOND = 'srv-second';
    await seedCar(ctx, SECOND);
    await shareCar(ctx, SECOND, viewer, 'viewer');
    ctx.sqlite.run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
      RESTRICTED,
      SECOND,
    ]);
    await overrideOn(ctx, CAR, viewer, 'vehicle.financing.read', 'allow');
    await overrideOn(ctx, CAR, viewer, 'vehicle.insurance.read', 'allow');
    expect(await listed(viewer.request)).toEqual([RUNNING]);
  });
});

describe('more expense views of a shared car follow the share settings', () => {
  function expense(id: string, category: string, extra: Record<string, unknown> = {}): void {
    const columns = [
      'id',
      'vehicle_id',
      'user_id',
      'category',
      'expense_amount',
      'date',
      'description',
      'mileage',
      ...Object.keys(extra),
    ];
    const values = [
      id,
      CAR,
      ctx.user.id,
      category,
      4000,
      JUNE,
      `Row ${id}`,
      12000,
      ...Object.values(extra),
    ];
    ctx.sqlite.run(
      `INSERT INTO expenses (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values as never[]
    );
  }

  test('a split group the share hides cannot be opened', async () => {
    const split = { group_id: 'srv-group', group_total: 8000, split_method: 'even' };
    expense('srv-leg-a', 'financial', split);
    expense('srv-leg-b', 'financial', split);
    expect((await viewer.request('GET', '/api/v1/expenses/split/srv-group')).status).toBe(404);
    expect((await ctx.authed('GET', '/api/v1/expenses/split/srv-group')).status).toBe(200);
  });

  test('a photo of a hidden expense is refused before the photo is looked up', async () => {
    expense('srv-hidden', 'financial');
    expense('srv-shown', 'maintenance');
    const hidden = await viewer.request(
      'GET',
      '/api/v1/photos/expense/srv-hidden/no-photo/thumbnail'
    );
    const shown = await viewer.request(
      'GET',
      '/api/v1/photos/expense/srv-shown/no-photo/thumbnail'
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toContain('Expense');
    expect(await shown.text()).not.toContain('Expense not found');
  });

  test('odometer history leaves out readings from hidden expenses', async () => {
    expense('srv-hidden-mileage', 'financial');
    expense('srv-shown-mileage', 'maintenance');
    const res = await viewer.request('GET', `/api/v1/odometer/${CAR}/history`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('srv-shown-mileage');
    expect(text).not.toContain('srv-hidden-mileage');
  });
});
