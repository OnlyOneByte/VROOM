import { expect } from 'bun:test';
import { type DataEnvelope, json, type TestApp } from './http-client';

export interface SeedVehicleOptions {
  make?: string;
  model?: string;
  year?: number;
  nickname?: string;
  extra?: Record<string, unknown>;
}

export async function seedVehicle(ctx: TestApp, opts: SeedVehicleOptions = {}): Promise<string> {
  const { make = 'Toyota', model = 'Camry', year = 2022, nickname, extra } = opts;
  const body: Record<string, unknown> = {
    make,
    model,
    year,
    ...(nickname ? { nickname } : {}),
    ...extra,
  };
  const res = await ctx.authed('POST', '/api/v1/vehicles', body);
  const parsed = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(parsed)).toBeLessThan(300);
  return parsed.data.id;
}
