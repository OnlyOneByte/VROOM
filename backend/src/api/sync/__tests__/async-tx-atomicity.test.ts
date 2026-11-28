import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type AppContext, repos } from '../../../app-context';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function reminderCount(): Promise<number> {
  const r = (await ctx.sql.get('SELECT COUNT(*) as n FROM reminders')) as { n: number };
  return r.n;
}
async function insuranceTermCount(): Promise<number> {
  const r = (await ctx.sql.get('SELECT COUNT(*) as n FROM insurance_terms')) as { n: number };
  return r.n;
}

describe('async-tx atomicity', () => {
  test('reminders.createWithVehicles rolls back the reminder when a junction insert fails', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    expect(await reminderCount()).toBe(0);

    let threw = false;
    try {
      await repos().reminders.createWithVehicles(
        {
          userId: ctx.user.id,
          name: 'Registration',
          type: 'notification',
          frequency: 'yearly',
          startDate: new Date('2024-02-01T00:00:00.000Z'),
        } as Parameters<AppContext['repos']['reminders']['createWithVehicles']>[0],
        [vehicleId, 'nonexistent-vehicle-id']
      );
    } catch {
      threw = true;
    }

    expect(threw, 'the FK violation should surface as a throw').toBe(true);
    expect(await reminderCount(), 'reminder row rolled back (no vehicle-less orphan)').toBe(0);
  });

  test('insurance.create rolls back the policy and terms when a term junction insert fails', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });

    expect(await insuranceTermCount()).toBe(0);
    const policiesBefore = (
      (await ctx.sql.get('SELECT COUNT(*) as n FROM insurance_policies')) as { n: number }
    ).n;

    let threw = false;
    try {
      await repos().insurancePolicies.create(
        {
          company: 'Acme',
          terms: [
            {
              startDate: new Date('2024-01-01T00:00:00.000Z'),
              endDate: new Date('2025-01-01T00:00:00.000Z'),
              vehicleCoverage: { vehicleIds: [vehicleId, 'nonexistent-vehicle-id'] },
            },
          ],
        } as Parameters<AppContext['repos']['insurancePolicies']['create']>[0],
        ctx.user.id
      );
    } catch {
      threw = true;
    }

    expect(threw, 'the unowned/bogus vehicle should reject the create').toBe(true);
    expect(await insuranceTermCount(), 'no orphan term row').toBe(0);
    expect(
      ((await ctx.sql.get('SELECT COUNT(*) as n FROM insurance_policies')) as { n: number }).n,
      'no orphan policy row'
    ).toBe(policiesBefore);
  });
});
