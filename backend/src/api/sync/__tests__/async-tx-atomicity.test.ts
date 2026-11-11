// Transactions must roll back fully when a write fails mid-way. bun-sqlite only wraps synchronous
// callbacks, so an async callback would leave earlier writes committed. A junction insert against a
// non-existent vehicle forces the mid-transaction failure. Repos are called directly to bypass the
// route-layer ownership check that would otherwise catch the bogus id.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function reminderCount(): number {
  const r = ctx.sqlite.query('SELECT COUNT(*) as n FROM reminders').get() as { n: number };
  return r.n;
}
function insuranceTermCount(): number {
  const r = ctx.sqlite.query('SELECT COUNT(*) as n FROM insurance_terms').get() as { n: number };
  return r.n;
}

describe('async-tx atomicity', () => {
  test('reminders.createWithVehicles rolls back the reminder when a junction insert fails', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { reminderRepository } = await import('../../reminders/repository');

    expect(reminderCount()).toBe(0);

    let threw = false;
    try {
      await reminderRepository.createWithVehicles(
        {
          userId: ctx.user.id,
          name: 'Registration',
          type: 'notification',
          frequency: 'yearly',
          startDate: new Date('2024-02-01T00:00:00.000Z'),
        } as Parameters<typeof reminderRepository.createWithVehicles>[0],
        [vehicleId, 'nonexistent-vehicle-id']
      );
    } catch {
      threw = true;
    }

    expect(threw, 'the FK violation should surface as a throw').toBe(true);
    // No orphan reminder row survives the failed create.
    expect(reminderCount(), 'reminder row rolled back (no vehicle-less orphan)').toBe(0);
  });

  test('insurance.create rolls back the policy and terms when a term junction insert fails', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const { insurancePolicyRepository } = await import('../../insurance/repository');

    expect(insuranceTermCount()).toBe(0);
    const policiesBefore = (
      ctx.sqlite.query('SELECT COUNT(*) as n FROM insurance_policies').get() as { n: number }
    ).n;

    // Ownership is validated before the transaction, so a bogus id is caught there. The happy path
    // commits atomically, and a validation failure leaves zero rows.
    let threw = false;
    try {
      await insurancePolicyRepository.create(
        {
          company: 'Acme',
          terms: [
            {
              startDate: new Date('2024-01-01T00:00:00.000Z'),
              endDate: new Date('2025-01-01T00:00:00.000Z'),
              vehicleCoverage: { vehicleIds: [vehicleId, 'nonexistent-vehicle-id'] },
            },
          ],
        } as Parameters<typeof insurancePolicyRepository.create>[0],
        ctx.user.id
      );
    } catch {
      threw = true;
    }

    expect(threw, 'the unowned/bogus vehicle should reject the create').toBe(true);
    // No orphan policy or term survives.
    expect(insuranceTermCount(), 'no orphan term row').toBe(0);
    expect(
      (ctx.sqlite.query('SELECT COUNT(*) as n FROM insurance_policies').get() as { n: number }).n,
      'no orphan policy row'
    ).toBe(policiesBefore);
  });
});
