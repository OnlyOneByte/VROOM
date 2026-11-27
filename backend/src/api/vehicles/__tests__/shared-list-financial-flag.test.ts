import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { overrideOn, seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
let viewer: Invitee;
const CAR = 'slf-car';

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  viewer = await createInvitee(ctx, 'slf-viewer');
  shareCar(ctx, CAR, viewer, 'viewer');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function sharedAccess(): Promise<{ seesFinancials?: boolean } | undefined> {
  const res = await viewer.request('GET', '/api/v1/vehicles?include=shared');
  expect(res.status).toBe(200);
  const rows = (await json<DataEnvelope<Array<{ id: string; sharedAccess?: object }>>>(res)).data;
  return rows.find((v) => v.id === CAR)?.sharedAccess;
}

describe('the shared car list says whether each share shows financial figures', () => {
  test('a share without financial access says so', async () => {
    expect(await sharedAccess()).toMatchObject({ seesFinancials: false });
  });

  test('a share with financial access says so too, matching the single-car view', async () => {
    overrideOn(ctx, CAR, viewer, 'vehicle.financing.read', 'allow');
    overrideOn(ctx, CAR, viewer, 'vehicle.insurance.read', 'allow');
    expect(await sharedAccess()).toMatchObject({ seesFinancials: true });

    const one = await viewer.request('GET', `/api/v1/vehicles/${CAR}`);
    const single = (await json<DataEnvelope<{ sharedAccess?: object }>>(one)).data.sharedAccess;
    expect(single).toMatchObject({ seesFinancials: true });
  });
});
