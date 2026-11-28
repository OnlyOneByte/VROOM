import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';
import { COMMUNITY_SCHEMA_VERSION } from '../aggregator';

const DAY = 86_400_000;
const MPG_PER_KM_PER_L = 3.785411784 / 1.609344;
const CIVIC_KEY = 'efficiency|honda-civic|2019|gas';
const communityConfig = CONFIG.communityStats as { mode: 'off' | 'local' };

interface CompareMetric {
  metric: string;
  status: string;
  unit: string | null;
  yours: number | null;
  bucket: Record<string, number | string> | null;
}

interface CompareBody {
  currency: string | null;
  metrics: CompareMetric[];
}

let ctx: TestApp;
let other: Invitee;

beforeEach(async () => {
  ctx = await createTestApp();
  other = await createInvitee(ctx, 'compare-other', 'Other');
}, SETUP_TIMEOUT_MS);
afterEach(() => {
  communityConfig.mode = 'local';
  ctx.close();
});

async function seedCivic(extra: Record<string, unknown> = { catalogModelId: 'honda-civic' }) {
  const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2019, extra });
  for (let i = 0; i < 6; i++) {
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(Date.now() - (6 - i) * 20 * DAY).toISOString(),
      mileage: 10_000 + i * 300,
      volume: 10,
      fuelType: '87 (Regular)',
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  }
  return vehicleId;
}

function insertBucket(bucketKey: string, metric: string, unit: string, n: number, mean: number) {
  ctx.sqlite.run(
    `INSERT INTO community_stats (id, scope, metric, bucket_key, currency, unit, n_published, mean, computed_at, schema_version)
     VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `row-${bucketKey}`,
      metric,
      bucketKey,
      metric === 'efficiency' ? null : 'USD',
      unit,
      n,
      mean,
      Math.floor(Date.now() / 1000),
      COMMUNITY_SCHEMA_VERSION,
    ]
  );
  markRefreshed();
}

function markRefreshed(offsetSeconds = 0): void {
  ctx.sqlite.run(
    "INSERT INTO community_refreshes (scope, refreshed_at) VALUES ('local', ?) ON CONFLICT(scope) DO UPDATE SET refreshed_at = excluded.refreshed_at",
    [Math.floor(Date.now() / 1000) + offsetSeconds]
  );
}

function consentedAt(userId: string): number {
  return (
    ctx.sqlite
      .query('SELECT community_stats_consented_at AS t FROM user_preferences WHERE user_id = ?')
      .get(userId) as { t: number }
  ).t;
}

async function optInNow(request: RequestFn = ctx.authed): Promise<void> {
  const res = await request('PUT', '/api/v1/settings', { communityStatsOptIn: true });
  expect(res.status).toBe(200);
}

function backdateConsent(): void {
  ctx.sqlite.run(
    'UPDATE user_preferences SET community_stats_consented_at = community_stats_consented_at - 86400 WHERE community_stats_opt_in = 1'
  );
}

async function optIn(request: RequestFn = ctx.authed): Promise<void> {
  await optInNow(request);
  backdateConsent();
}

async function compare(vehicleId: string, request: RequestFn = ctx.authed) {
  const res = await request('GET', `/api/v1/community/compare?vehicleId=${vehicleId}`);
  return {
    res,
    body: res.status === 200 ? (await json<DataEnvelope<CompareBody>>(res)).data : null,
  };
}

function metric(body: CompareBody | null, name: string): CompareMetric | undefined {
  return body?.metrics.find((m) => m.metric === name);
}

describe('GET /api/v1/community/compare', () => {
  test('a caller who has not opted in gets no numbers at all', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);

    const { res, body } = await compare(vehicleId);
    expect(res.status).toBe(200);
    expect(body?.metrics.every((m) => m.status === 'opt_in_required')).toBe(true);
    expect(body?.metrics.every((m) => m.yours === null && m.bucket === null)).toBe(true);
    expect(body?.currency).toBeNull();
  });

  test('an opted-in owner sees the bucket converted to the vehicle units', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn();

    const { body } = await compare(vehicleId);
    const efficiency = metric(body, 'efficiency');
    expect(efficiency?.status).toBe('ok');
    expect(efficiency?.unit).toBe('distance_per_volume');
    expect(efficiency?.yours).toBeCloseTo(30, 6);
    expect(efficiency?.bucket?.n).toBe(40);
    expect(efficiency?.bucket?.mean as number).toBeCloseTo(12 * MPG_PER_KM_PER_L, 6);
    expect(Object.keys(efficiency?.bucket ?? {}).sort()).toEqual(['computedAt', 'mean', 'n']);
    expect(body?.currency).toBe('USD');
  });

  test('an opt-in after the last refresh waits for the next one before showing numbers', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    markRefreshed(-3600);
    await optInNow();

    const waiting = (await compare(vehicleId)).body;
    expect(waiting?.metrics.every((m) => m.status === 'awaiting_refresh')).toBe(true);
    expect(waiting?.metrics.every((m) => m.yours === null && m.bucket === null)).toBe(true);
    expect(waiting?.currency).toBeNull();

    markRefreshed(3600);
    expect(metric((await compare(vehicleId)).body, 'efficiency')?.status).toBe('ok');
  });

  test('with no snapshot yet, an opted-in caller is still waiting', async () => {
    const vehicleId = await seedCivic();
    await optIn();
    const { body } = await compare(vehicleId);
    expect(body?.metrics.every((m) => m.status === 'awaiting_refresh')).toBe(true);
  });

  test('opting out hides comparisons at once, and opting back in waits for a refresh', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn();
    expect(metric((await compare(vehicleId)).body, 'efficiency')?.status).toBe('ok');

    await ctx.authed('PUT', '/api/v1/settings', { communityStatsOptIn: false });
    expect(
      (await compare(vehicleId)).body?.metrics.every((m) => m.status === 'opt_in_required')
    ).toBe(true);

    await optInNow();
    expect(
      (await compare(vehicleId)).body?.metrics.every((m) => m.status === 'awaiting_refresh')
    ).toBe(true);
  });

  test('a refresh that published no groups still counts, so the caller sees too_few or no_data', async () => {
    const vehicleId = await seedCivic();
    markRefreshed();
    await optIn();
    const { body } = await compare(vehicleId);
    expect(metric(body, 'efficiency')?.status).toBe('too_few');
    expect(metric(body, 'insurance')?.status).toBe('no_data');
    expect(body?.metrics.some((m) => m.status === 'awaiting_refresh')).toBe(false);
  });

  test('a consent stamped in the same second as the refresh still waits', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optInNow();
    ctx.sqlite.run("UPDATE community_refreshes SET refreshed_at = ? WHERE scope = 'local'", [
      consentedAt(ctx.user.id),
    ]);
    const { body } = await compare(vehicleId);
    expect(body?.metrics.every((m) => m.status === 'awaiting_refresh')).toBe(true);
  });

  test('a share recipient who just opted in waits even though the owner is included', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn();
    await other.acceptShare(vehicleId, 'viewer');
    await optInNow(other.request);

    expect(metric((await compare(vehicleId)).body, 'efficiency')?.status).toBe('ok');
    const shared = (await compare(vehicleId, other.request)).body;
    expect(shared?.metrics.every((m) => m.status === 'awaiting_refresh' && m.bucket === null)).toBe(
      true
    );
    expect(shared?.currency).toBeNull();
  });

  test('an average whose noise is over a quarter of its value is hidden as not_enough_data', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 30, 12);
    await optIn();
    const hidden = metric((await compare(vehicleId)).body, 'efficiency');
    expect(hidden?.status).toBe('not_enough_data');
    expect(hidden?.bucket).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('"n"');

    ctx.sqlite.run('UPDATE community_stats SET n_published = 40 WHERE bucket_key = ?', [CIVIC_KEY]);
    expect(metric((await compare(vehicleId)).body, 'efficiency')?.status).toBe('ok');
  });

  test("a rated model's narrower band shows its average from the smallest published group", async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 30, 12);
    ctx.sqlite.run(
      "UPDATE community_stats SET catalog_model_id = 'honda-civic', model_year = 2019, vehicle_type = 'gas' WHERE bucket_key = ?",
      [CIVIC_KEY]
    );
    await optIn();
    const shown = metric((await compare(vehicleId)).body, 'efficiency');
    expect(shown?.status).toBe('ok');
    expect(shown?.bucket?.n).toBe(30);
  });

  test('a row below the publication threshold in the table is never returned', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 25, 12);
    await optIn();

    const { body } = await compare(vehicleId);
    const efficiency = metric(body, 'efficiency');
    expect(efficiency?.status).toBe('too_few');
    expect(efficiency?.bucket).toBeNull();
    expect(JSON.stringify(body)).not.toContain('"n":25');
  });

  test('a vehicle without a catalogue model asks for one, and missing data says so', async () => {
    const vehicleId = await seedCivic({});
    markRefreshed();
    await optIn();

    const { body } = await compare(vehicleId);
    expect(metric(body, 'efficiency')?.status).toBe('needs_model');
    expect(metric(body, 'insurance')?.status).toBe('no_data');
    expect(metric(body, 'running_cost')?.status).toBe('too_few');
  });

  test("another user's vehicle is a 404, even for an opted-in caller", async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn(other.request);

    const { res } = await compare(vehicleId, other.request);
    expect(res.status).toBe(404);
  });

  test('an accepted share recipient who opted in can read the comparison', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await other.acceptShare(vehicleId, 'viewer');
    await optIn(other.request);

    const { res, body } = await compare(vehicleId, other.request);
    expect(res.status).toBe(200);
    expect(metric(body, 'efficiency')?.status).toBe('ok');
  });

  test("a share recipient never sees metrics keyed by the owner's region", async () => {
    await ctx.authed('PUT', '/api/v1/settings', { communityRegion: 'US-CA' });
    const vehicleId = await seedCivic();
    insertBucket('running_cost|gas|car|USD|US-CA', 'running_cost', 'cents_per_km', 400, 9);
    await optIn();
    await other.acceptShare(vehicleId, 'viewer');
    await optIn(other.request);

    expect(metric((await compare(vehicleId)).body, 'running_cost')?.status).toBe('ok');
    const shared = (await compare(vehicleId, other.request)).body;
    for (const name of ['running_cost', 'insurance']) {
      expect(metric(shared, name)).toEqual({
        metric: name,
        status: 'no_data',
        unit: null,
        yours: null,
        bucket: null,
      });
    }
  });

  test('a share recipient who has not opted in gets no numbers from an opted-in owner', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn();
    await other.acceptShare(vehicleId, 'viewer');

    const { body } = await compare(vehicleId, other.request);
    expect(body?.metrics.every((m) => m.status === 'opt_in_required' && m.bucket === null)).toBe(
      true
    );
  });

  test('the server switch set to off returns feature_off and no numbers', async () => {
    const vehicleId = await seedCivic();
    insertBucket(CIVIC_KEY, 'efficiency', 'km_per_l', 40, 12);
    await optIn();
    communityConfig.mode = 'off';

    const { body } = await compare(vehicleId);
    expect(body?.metrics.every((m) => m.status === 'feature_off' && m.bucket === null)).toBe(true);
  });

  test('a missing vehicleId is rejected', async () => {
    const res = await ctx.authed('GET', '/api/v1/community/compare');
    expect(res.status).toBe(400);
  });
});
