import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../config';
import SHARED_LIMITS from '../shared-limits.json';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

describe('shared input limits', () => {
  test('CONFIG.validation reads every shared limit from shared-limits.json', () => {
    expect(CONFIG.validation.vehicle.minYear).toBe(SHARED_LIMITS.vehicle.minYear);
    expect(CONFIG.validation.vehicle.maxYearsAhead).toBe(SHARED_LIMITS.vehicle.maxYearsAhead);
    expect(CONFIG.validation.vehicle.vinMinLength).toBe(SHARED_LIMITS.vehicle.vinMinLength);
    expect(CONFIG.validation.vehicle.vinMaxLength).toBe(SHARED_LIMITS.vehicle.vinMaxLength);
    expect(CONFIG.validation.expense.maxAmount).toBe(SHARED_LIMITS.expense.maxAmount);
    expect(CONFIG.validation.trip.noteMaxLength).toBe(SHARED_LIMITS.trip.noteMaxLength);
  });
});

describe('vehicle year cap', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => {
    ctx.close();
  });

  test('accepts the last allowed year and refuses the one after it', async () => {
    const lastAllowed = new Date().getFullYear() + SHARED_LIMITS.vehicle.maxYearsAhead;
    const ok = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: 'CX-5',
      year: lastAllowed,
    });
    expect(ok.status).toBe(201);

    const refused = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: 'CX-5',
      year: lastAllowed + 1,
    });
    expect(refused.status).toBe(400);
  });
});
