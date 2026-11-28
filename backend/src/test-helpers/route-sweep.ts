import { CONFIG } from '../config';
import { isPublicRule, ROUTE_PERMISSIONS } from '../permissions/route-map';
import type { TestApp } from './http-client';
import { type Members, seedCar, seedMembers } from './members';
import { type SweepCall, writeRouteCalls } from './route-bodies';
import { seedSweepRecords, storeSweepPhotos } from './sweep-records';

export const VEHICLE_ID = 'sweep-car';

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const VEHICLE_DELETE = 'DELETE /api/v1/vehicles/:id';

const sweepRank = (key: string): [number, number, number] => {
  const [method = '', path = ''] = key.split(' ');
  const methodRank = METHOD_ORDER.indexOf(method);
  if (method !== 'DELETE') return [methodRank, 0, 0];
  return [methodRank, key === VEHICLE_DELETE ? 1 : 0, -path.split('/').length];
};

export const SWEPT_KEYS = Object.entries(ROUTE_PERMISSIONS)
  .filter(([, rule]) => !isPublicRule(rule))
  .map(([key]) => key)
  .sort((a, b) => {
    const [ra, rb] = [sweepRank(a), sweepRank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });

const isWrite = (method: string) => method !== 'GET' && method !== 'DELETE';

export const quietPush = { send: async () => ({ kind: 'ok' as const }) };

const config = CONFIG as { disableRateLimit: boolean; allowFakeStorageProvider: boolean };
const configWas = {
  disableRateLimit: config.disableRateLimit,
  allowFakeStorageProvider: config.allowFakeStorageProvider,
};
export const sweepConfig = (on: boolean) => {
  config.disableRateLimit = on || configWas.disableRateLimit;
  config.allowFakeStorageProvider = on || configWas.allowFakeStorageProvider;
};

export function sweepRequests(
  memberId: string
): [key: string, method: string, path: string, call: SweepCall | undefined][] {
  const calls = writeRouteCalls(VEHICLE_ID, memberId);
  return SWEPT_KEYS.map((key) => {
    const [method = 'GET', template = '/'] = key.split(' ');
    const call = calls[key] ?? (isWrite(method) ? { body: { vehicleId: VEHICLE_ID } } : undefined);
    const path = call?.path ?? template.replace(/:[A-Za-z]+/g, VEHICLE_ID);
    return [key, method, `${path}${path.includes('?') ? '&' : '?'}vehicleId=${VEHICLE_ID}`, call];
  });
}

export async function seedSweepCar(ctx: TestApp): Promise<Members> {
  await seedCar(ctx, VEHICLE_ID);
  ctx.sqlite.run('UPDATE vehicles SET car_share_enabled = 1 WHERE id = ?', [VEHICLE_ID]);
  const members = await seedMembers(ctx, VEHICLE_ID, 'sweep');
  seedSweepRecords(ctx, VEHICLE_ID, members.stranger.id);
  await storeSweepPhotos(ctx, VEHICLE_ID);
  return members;
}
