import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PERMISSION_REGISTRY } from '../../../permissions/registry';
import { ROLE_TEMPLATES } from '../../../permissions/roles';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

interface CapabilitiesBody {
  permissions: {
    id: string;
    label: string;
    scope: string;
    grantable: boolean;
    implies: string[];
    sensitive: boolean;
  }[];
  roles: { key: string; name: string; scope: string; permissions: string[] }[];
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);

afterEach(() => ctx.close());

describe('GET /api/v1/auth/capabilities', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/auth/capabilities');
    expect(res.status).toBe(401);
  });

  test('serves every descriptor and the role templates', async () => {
    const res = await ctx.authed('GET', '/api/v1/auth/capabilities');
    const body = await json<DataEnvelope<CapabilitiesBody>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    expect(body.data.permissions).toHaveLength(PERMISSION_REGISTRY.list.length);
    expect(body.data.permissions.find((p) => p.id === 'vehicle.financing.read')).toEqual({
      id: 'vehicle.financing.read',
      label: 'See loan and lease details',
      scope: 'vehicle',
      grantable: true,
      implies: [],
      sensitive: true,
    });
    expect(body.data.permissions.find((p) => p.id === 'vehicle.delete')?.grantable).toBe(false);
    expect(body.data.roles.map((r) => r.key)).toEqual(ROLE_TEMPLATES.map((r) => r.key));
    expect(body.data.roles.find((r) => r.key === 'editor')?.permissions).toContain(
      'vehicle.expense.write'
    );
  });
});
