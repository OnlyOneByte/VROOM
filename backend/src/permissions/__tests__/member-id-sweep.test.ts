import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setPushSenderForTest } from '../../api/push/push-service';
import {
  createTestApp,
  requestAs,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../test-helpers/http-client';
import type { Members } from '../../test-helpers/members';
import { sendSweepCall } from '../../test-helpers/route-bodies';
import {
  quietPush,
  seedSweepCar,
  sweepConfig,
  sweepRequests,
  VEHICLE_ID,
} from '../../test-helpers/route-sweep';

type Role = 'viewer' | 'editor' | 'coOwner';
const ROLES: readonly Role[] = ['viewer', 'editor', 'coOwner'];

interface Exception {
  roles: readonly Role[];
  why: string;
}

const ALLOWED: Record<string, Exception> = {
  'GET /api/v1/vehicles/:id/people $.data[].userId': {
    roles: ['coOwner'],
    why: 'A co-owner manages members; role and override changes name the member by this id.',
  },
  'POST /api/v1/role-assignments $.data.userId': {
    roles: ['coOwner'],
    why: 'Echoes the member the co-owner just assigned a role to.',
  },
  'PUT /api/v1/overrides $.data.userId': {
    roles: ['coOwner'],
    why: 'Echoes the member the co-owner just set an override for.',
  },
};

const KNOWN_GAPS: Record<string, Exception> = {};

async function seedMemberRecords(ctx: TestApp, members: Members): Promise<void> {
  const run = (sql: string, params: (string | number)[]) => ctx.sql.run(sql, params);
  const owner = ctx.user.id;
  for (const [tag, author] of [
    ['editor', members.editor.id],
    ['co', members.coOwner.id],
  ] as const) {
    const id = `${VEHICLE_ID}-by-${tag}`;
    await run(
      "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, user_id, created_by) VALUES (?, ?, 'fuel', 1717300000, 20, ?, ?)",
      [id, VEHICLE_ID, owner, author]
    );
    await run(
      'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at, created_by) VALUES (?, ?, ?, 1200, 1717300000, ?)',
      [id, VEHICLE_ID, owner, author]
    );
    await run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_by) VALUES (?, ?, ?, 1100, 1100, 'personal', 1717300000, ?)",
      [id, VEHICLE_ID, owner, author]
    );
    await run(
      "INSERT INTO reminders (id, user_id, name, type, frequency, start_date, created_by) VALUES (?, ?, 'Member', 'notification', 'monthly', 1717300000, ?)",
      [id, owner, author]
    );
    await run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
      id,
      VEHICLE_ID,
    ]);
    await run(
      "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, created_by) VALUES (?, ?, 'vehicle', ?, 'm.jpg', 'image/jpeg', 4, ?)",
      [id, owner, VEHICLE_ID, author]
    );
    await run('INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES (?, ?, ?, ?)', [
      id,
      VEHICLE_ID,
      author,
      tag,
    ]);
  }
}

function otherAccounts(ctx: TestApp, members: Members, role: Role): Map<string, string> {
  const all: [string, string][] = [
    [ctx.user.id, 'owner'],
    [members.coOwner.id, 'co-owner'],
    [members.editor.id, 'editor'],
    [members.viewer.id, 'viewer'],
    [members.stranger.id, 'stranger'],
    [members.disabled.id, 'disabled member'],
  ];
  return new Map(all.filter(([id]) => id !== members[role].id));
}

function fieldsHolding(value: unknown, ids: Map<string, string>, path: string, out: Set<string>) {
  if (typeof value === 'string') {
    for (const id of ids.keys()) if (value.includes(id)) out.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) fieldsHolding(item, ids, `${path}[]`, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      fieldsHolding(child, ids, `${path}.${key}`, out);
    }
  }
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const appliesTo = (table: Record<string, Exception>, field: string, role: Role) =>
  table[field]?.roles.includes(role) === true;

function sortFields(
  found: Set<string>,
  key: string,
  role: Role,
  unexpected: Set<string>,
  gapsSeen: Set<string>
): void {
  for (const hit of found) {
    const field = `${key} ${hit}`;
    if (appliesTo(ALLOWED, field, role)) continue;
    if (appliesTo(KNOWN_GAPS, field, role)) gapsSeen.add(field);
    else unexpected.add(field);
  }
}

function headerNamesAny(res: Response, ids: Map<string, string>): boolean {
  const header = [...res.headers.values()].join(' ');
  return [...ids.keys()].some((id) => header.includes(id));
}

describe('responses to members of a shared car', () => {
  let ctx: TestApp;
  let members: Members;

  beforeEach(async () => {
    ctx = await createTestApp();
    sweepConfig(true);
    members = await seedSweepCar(ctx);
    await seedMemberRecords(ctx, members);
    setPushSenderForTest(quietPush);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => {
    setPushSenderForTest(null);
    sweepConfig(false);
    ctx.close();
  });

  async function sweepAs(role: Role) {
    const ids = otherAccounts(ctx, members, role);
    const unexpected = new Set<string>();
    const gapsSeen = new Set<string>();
    const invites = [`${VEHICLE_ID}-accept`, `${VEHICLE_ID}-decline`];
    await ctx.sql.run('UPDATE vehicle_shares SET shared_with_id = ? WHERE id IN (?, ?)', [
      members[role].id,
      ...invites,
    ]);
    const invitesAnswered = new Set<string>();
    let answered = 0;
    for (const [key, method, path, call] of sweepRequests(members.editor.id)) {
      const { cookie } = await requestAs(ctx, members[role].id);
      const res = await sendSweepCall(ctx.app, cookie, method, path, call ?? {});
      if (res.ok) answered++;
      if (res.ok && key.startsWith('POST /api/v1/shares/:id/')) invitesAnswered.add(key);
      const found = new Set<string>();
      fieldsHolding(parsed(await res.text()), ids, '$', found);
      sortFields(found, key, role, unexpected, gapsSeen);
      if (headerNamesAny(res, ids)) unexpected.add(`${key} (a response header)`);
    }
    const gapsExpected = Object.keys(KNOWN_GAPS).filter((f) => appliesTo(KNOWN_GAPS, f, role));
    return {
      unexpected: [...unexpected].sort(),
      gapsSeen: [...gapsSeen].sort(),
      gapsExpected,
      answered,
      invitesAnswered: [...invitesAnswered].sort(),
    };
  }

  for (const role of ROLES) {
    test(`a ${role} sees no other account's id outside the reviewed allowlist`, async () => {
      const { unexpected, gapsSeen, gapsExpected, answered, invitesAnswered } = await sweepAs(role);
      expect(answered, 'the sweep reached the routes').toBeGreaterThan(60);
      expect(invitesAnswered).toEqual([
        'POST /api/v1/shares/:id/accept',
        'POST /api/v1/shares/:id/decline',
      ]);
      expect(unexpected).toEqual([]);
      expect(gapsSeen, 'a known gap that no longer shows is fixed: remove its entry').toEqual(
        gapsExpected.sort()
      );
    }, 180_000);
  }

  test('every allowlist and known-gap entry says why', () => {
    for (const [field, entry] of Object.entries({ ...ALLOWED, ...KNOWN_GAPS })) {
      expect(entry.why.trim().length, field).toBeGreaterThan(0);
      expect(entry.roles.length, field).toBeGreaterThan(0);
    }
  });
});
