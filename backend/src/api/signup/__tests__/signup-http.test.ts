import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isPublicRule, ROUTE_PERMISSIONS } from '../../../permissions/route-map';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  requestAs,
  type TestApp,
} from '../../../test-helpers/http-client';
import { defaultPrivateProviderEndpoints } from '../../../test-helpers/outbound';
import { seedVehicle } from '../../../test-helpers/seed';
import { SIGNUP_MODES } from '../policy';

let ctx: TestApp;
let resolveNewUser: typeof import('../../auth/routes').resolveNewUser;
let frontend: string;
let signupConfig: { mode?: string; allowedDomains?: string };
let adminConfig: { adminEmails: string[] };
let admin: RequestFn;

let identity = 0;
function signUp(email: string) {
  identity++;
  return resolveNewUser('google', {
    providerAccountId: `g-${identity}`,
    email,
    displayName: `Person ${identity}`,
  });
}

function setMode(mode: string, domains = ''): void {
  ctx.sqlite.run(
    'UPDATE server_settings SET signup_mode = ?, allowed_email_domains = ? WHERE id = 1',
    [mode, domains]
  );
}

function userByEmail(email: string) {
  return ctx.sqlite
    .query('SELECT id, pending_approval_at AS pending FROM users WHERE email = ?')
    .get(email) as { id: string; pending: number | null } | null;
}

const WAITING_MAY_USE = new Set([
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/capabilities',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/auth/callback/link/:authProvider',
  'GET /api/v1/auth/callback/provider/google',
]);

function shareHolder(shareId: string): string | null {
  return (
    ctx.sqlite
      .query('SELECT shared_with_id AS id FROM vehicle_shares WHERE id = ?')
      .get(shareId) as {
      id: string | null;
    }
  ).id;
}

function serverRoles(userId: string): string[] {
  return (
    ctx.sqlite
      .query(
        'SELECT role_id AS r FROM role_assignments WHERE user_id = ? AND scope_id IS NULL ORDER BY r'
      )
      .all(userId) as { r: string }[]
  ).map((row) => row.r);
}

beforeEach(async () => {
  ctx = await createTestApp();
  ({ resolveNewUser } = await import('../../auth/routes'));
  const { CONFIG } = await import('../../../config');
  frontend = CONFIG.frontend.url;
  signupConfig = CONFIG.signup as typeof signupConfig;
  adminConfig = CONFIG as typeof adminConfig;
  const { assignServerRole } = await import('../../../permissions/grants');
  const { getDb } = await import('../../../db/connection');
  assignServerRole(getDb(), ctx.user.id, 'admin');
  admin = ctx.authed;
});

afterEach(() => {
  signupConfig.mode = undefined;
  signupConfig.allowedDomains = undefined;
  adminConfig.adminEmails = [];
  ctx.close();
});

describe('sign-up modes', () => {
  test('open admits a new member', async () => {
    setMode('open');
    expect(await signUp('open@example.com')).toHaveProperty('userId');
    const user = userByEmail('open@example.com');
    expect(user?.pending).toBeNull();
    expect(serverRoles(user?.id ?? '')).toEqual(['builtin_member']);
  });

  test.each([
    ['invite', 'signup_invite_required'],
    ['closed', 'signup_closed'],
  ])('%s refuses a stranger with a clear reason and no user row', async (mode, code) => {
    setMode(mode);
    expect(await signUp('stranger@example.com')).toEqual({
      redirect: `${frontend}/auth?auth_error=${code}`,
    });
    expect(userByEmail('stranger@example.com')).toBeNull();
  });

  test('allowed domains admit listed domains only', async () => {
    setMode('open', 'example.com');
    expect(await signUp('ok@example.com')).toHaveProperty('userId');
    expect(await signUp('no@elsewhere.org')).toEqual({
      redirect: `${frontend}/auth?auth_error=signup_domain_not_allowed`,
    });
    expect(userByEmail('no@elsewhere.org')).toBeNull();
  });

  test('a pending vehicle-share invite from an active owner admits its email in invite only', async () => {
    setMode('invite');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2018 });
    ctx.sqlite.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES ('s1', ?, ?, 'viewer', 'pending', 'friend@example.com')",
      [vehicleId, ctx.user.id]
    );
    expect(await signUp('friend@example.com')).toHaveProperty('userId');
    ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [ctx.user.id]);
    ctx.sqlite.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES ('s2', ?, ?, 'viewer', 'pending', 'late@example.com')",
      [vehicleId, ctx.user.id]
    );
    expect(await signUp('late@example.com')).toHaveProperty('redirect');
  });

  test('SIGNUP_MODE wins over the stored mode and locks it', async () => {
    setMode('open');
    signupConfig.mode = 'closed';
    expect(await signUp('blocked@example.com')).toHaveProperty('redirect');
    const settings = await json<DataEnvelope<{ mode: string; modeLocked: boolean }>>(
      await admin('GET', '/api/v1/admin/signup')
    );
    expect(settings.data).toMatchObject({ mode: 'closed', modeLocked: true });
    expect((await admin('PUT', '/api/v1/admin/signup', { mode: 'open' })).status).toBe(409);
  });

  test('the first account on an empty server is admin, bypasses the mode, and starts invite only', async () => {
    ctx.sqlite.run('DELETE FROM users');
    ctx.sqlite.run('DELETE FROM server_settings');
    signupConfig.mode = 'closed';
    const first = await signUp('owner@example.com');
    expect(first).toHaveProperty('userId');
    expect(serverRoles((first as { userId: string }).userId)).toEqual([
      'builtin_admin',
      'builtin_member',
    ]);
    signupConfig.mode = undefined;
    expect(
      (ctx.sqlite.query('SELECT signup_mode AS m FROM server_settings').get() as { m: string }).m
    ).toBe('invite');
    expect(await signUp('second@example.com')).toEqual({
      redirect: `${frontend}/auth?auth_error=signup_invite_required`,
    });
  });

  test('with ADMIN_EMAILS set, only a listed email becomes the first admin', async () => {
    ctx.sqlite.run('DELETE FROM users');
    ctx.sqlite.run('DELETE FROM server_settings');
    adminConfig.adminEmails = ['boss@example.com'];
    expect(await signUp('stranger@example.com')).toEqual({
      redirect: `${frontend}/auth?auth_error=signup_invite_required`,
    });
    expect(userByEmail('stranger@example.com')).toBeNull();
    const boss = (await signUp('Boss@Example.com')) as { userId: string };
    expect(serverRoles(boss.userId)).toEqual(['builtin_admin', 'builtin_member']);
  });
});

describe('a server with no admin', () => {
  let ensureServerAdmin: typeof import('../store').ensureServerAdmin;
  let db: ReturnType<typeof import('../../../db/connection').getDb>;

  beforeEach(async () => {
    ({ ensureServerAdmin } = await import('../store'));
    db = (await import('../../../db/connection')).getDb();
    ctx.sqlite.run('DELETE FROM users');
    for (const [id, created, disabled, pending] of [
      ['disabled', 1, 1, null],
      ['undated', null, null, null],
      ['waiting', 2, null, 2],
      ['oldest', 3, null, null],
      ['newer', 4, null, null],
    ] as const) {
      ctx.sqlite.run(
        'INSERT INTO users (id, email, display_name, created_at, disabled_at, pending_approval_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, `${id}@example.com`, id, created, disabled, pending]
      );
    }
  });

  test('gets its oldest active, dated account as admin at startup, once', () => {
    expect(ensureServerAdmin(db)).toBe('oldest');
    expect(ensureServerAdmin(db)).toBeNull();
    expect(serverRoles('oldest')).toEqual(['builtin_admin']);
  });

  test('with ADMIN_EMAILS set, gets only a listed account as admin', () => {
    adminConfig.adminEmails = ['newer@example.com', 'disabled@example.com'];
    expect(ensureServerAdmin(db)).toBe('newer');
    ctx.sqlite.run('DELETE FROM role_assignments');
    adminConfig.adminEmails = ['nobody@example.com'];
    expect(ensureServerAdmin(db)).toBeNull();
  });
});

describe('approval', () => {
  test('a waiting account reaches no data route until an admin approves it', async () => {
    setMode('approval');
    const { userId } = (await signUp('waiting@example.com')) as { userId: string };
    expect(serverRoles(userId)).toEqual([]);
    const waiting = (await requestAs(ctx, userId)).request;

    const reachable: string[] = [];
    for (const [route, rule] of Object.entries(ROUTE_PERMISSIONS)) {
      if (isPublicRule(rule) || WAITING_MAY_USE.has(route)) continue;
      const [method = '', pattern = ''] = route.split(' ');
      const res = await waiting(
        method as 'GET',
        pattern.replace(/:\w+/g, 'x'),
        method === 'GET' ? undefined : {}
      );
      const refused =
        res.status === 403 &&
        (await json<{ error?: { code?: string } }>(res)).error?.code === 'ACCOUNT_PENDING';
      if (!refused) reachable.push(`${route} -> ${res.status}`);
    }
    expect(reachable).toEqual([]);
    const me = await json<DataEnvelope<{ pendingApproval: boolean }>>(
      await waiting('GET', '/api/v1/auth/me')
    );
    expect(me.data.pendingApproval).toBe(true);

    const pending = await json<DataEnvelope<{ id: string }[]>>(
      await admin('GET', '/api/v1/admin/pending-accounts')
    );
    expect(pending.data.map((p) => p.id)).toEqual([userId]);
    expect((await admin('POST', `/api/v1/admin/pending-accounts/${userId}/approve`)).status).toBe(
      200
    );
    expect(serverRoles(userId)).toEqual(['builtin_member']);
    expect((await waiting('GET', '/api/v1/vehicles')).status).toBe(200);
  });

  test('a vehicle-share invite reaches a waiting account only once it is approved', async () => {
    setMode('approval');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2018 });
    ctx.sqlite.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES ('s1', ?, ?, 'viewer', 'pending', 'later@example.com')",
      [vehicleId, ctx.user.id]
    );
    const { userId } = (await signUp('later@example.com')) as { userId: string };
    expect(shareHolder('s1')).toBeNull();
    await admin('POST', `/api/v1/admin/pending-accounts/${userId}/approve`);
    expect(shareHolder('s1')).toBe(userId);
  });

  test('rejecting a waiting account deletes it and keeps the invites sent to its email', async () => {
    setMode('approval');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2018 });
    ctx.sqlite.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES ('s1', ?, ?, 'viewer', 'pending', 'nope@example.com')",
      [vehicleId, ctx.user.id]
    );
    const { userId } = (await signUp('nope@example.com')) as { userId: string };
    expect((await admin('DELETE', `/api/v1/admin/pending-accounts/${ctx.user.id}`)).status).toBe(
      404
    );
    expect((await admin('DELETE', `/api/v1/admin/pending-accounts/${userId}`)).status).toBe(200);
    expect(userByEmail('nope@example.com')).toBeNull();
    expect(ctx.sqlite.query("SELECT status FROM vehicle_shares WHERE id = 's1'").get()).toEqual({
      status: 'pending',
    });
  });
});

describe('server invites', () => {
  async function invite(email: string, expiresInDays?: number) {
    return admin('POST', '/api/v1/admin/invites', { email, expiresInDays });
  }

  test('an invite admits its email once, in invite only, past the domain list', async () => {
    setMode('invite', 'example.com');
    expect((await invite('Guest@Other.org')).status).toBe(201);
    expect((await invite('guest@other.org')).status).toBe(409);
    expect(await signUp('guest@other.org')).toHaveProperty('userId');

    const list = await json<DataEnvelope<{ email: string; status: string }[]>>(
      await admin('GET', '/api/v1/admin/invites')
    );
    expect(list.data).toEqual([
      expect.objectContaining({ email: 'guest@other.org', status: 'used' }),
    ]);

    ctx.sqlite.run("DELETE FROM users WHERE email = 'guest@other.org'");
    expect(await signUp('guest@other.org')).toHaveProperty('redirect');
  });

  test('a revoked or expired invite admits nobody', async () => {
    setMode('invite');
    const created = await json<DataEnvelope<{ id: string }>>(await invite('revoked@example.com'));
    expect((await admin('DELETE', `/api/v1/admin/invites/${created.data.id}`)).status).toBe(200);
    expect((await admin('DELETE', `/api/v1/admin/invites/${created.data.id}`)).status).toBe(409);
    expect(await signUp('revoked@example.com')).toHaveProperty('redirect');

    await invite('expired@example.com', 1);
    ctx.sqlite.run("UPDATE server_invites SET expires_at = 1 WHERE email = 'expired@example.com'");
    expect(await signUp('expired@example.com')).toHaveProperty('redirect');
    expect(userByEmail('expired@example.com')).toBeNull();
  });

  test('invite input is validated', async () => {
    expect((await invite('not-an-email')).status).toBe(400);
    expect((await invite('a@example.com', 0)).status).toBe(400);
    expect((await invite('a@example.com', 365)).status).toBe(400);
  });
});

describe('admin routes', () => {
  test('a member without server.signup.manage is refused every one', async () => {
    const { assignServerRole } = await import('../../../permissions/grants');
    const { getDb } = await import('../../../db/connection');
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('m1', 'm1@example.com', 'M')"
    );
    assignServerRole(getDb(), 'm1', 'member');
    const member = (await requestAs(ctx, 'm1')).request;
    for (const [method, path, body] of [
      ['GET', '/api/v1/admin/signup'],
      ['PUT', '/api/v1/admin/signup', { mode: 'open' }],
      ['GET', '/api/v1/admin/invites'],
      ['POST', '/api/v1/admin/invites', { email: 'x@example.com' }],
      ['DELETE', '/api/v1/admin/invites/abc'],
      ['GET', '/api/v1/admin/pending-accounts'],
      ['POST', '/api/v1/admin/pending-accounts/abc/approve'],
      ['DELETE', '/api/v1/admin/pending-accounts/abc'],
    ] as const) {
      expect((await member(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect((await ctx.anon('GET', '/api/v1/admin/signup')).status).toBe(401);
  });

  test('an admin changes the mode and the domain list', async () => {
    const res = await admin('PUT', '/api/v1/admin/signup', {
      mode: 'approval',
      allowedDomains: ['@Example.com', 'other.org'],
    });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<unknown>>(res)).data).toEqual({
      mode: 'approval',
      modeLocked: false,
      allowedDomains: ['example.com', 'other.org'],
      domainsLocked: false,
    });
    expect((await admin('PUT', '/api/v1/admin/signup', { mode: 'everyone' })).status).toBe(400);
    expect(
      (await admin('PUT', '/api/v1/admin/signup', { allowedDomains: ['not a domain'] })).status
    ).toBe(400);
  });
});

describe('private provider targets', () => {
  defaultPrivateProviderEndpoints();

  test('no sign-up mode allows them once a second account exists', async () => {
    const { privateEndpointPolicy } = await import('../../../utils/outbound-url');
    for (const mode of SIGNUP_MODES) {
      setMode(mode);
      expect(privateEndpointPolicy().allowAll, mode).toBe(true);
    }
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'u2@example.com', 'U2')"
    );
    for (const mode of SIGNUP_MODES) {
      setMode(mode);
      expect(privateEndpointPolicy().allowAll, mode).toBe(false);
    }
  });
});
