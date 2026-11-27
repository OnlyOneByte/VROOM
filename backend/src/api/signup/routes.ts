import { and, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { appContext } from '../../app-context';
import { CONFIG } from '../../config';
import type { AsyncHandle } from '../../db/async-sqlite';
import { type serverInvites, users } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, type ResourceOf } from '../../permissions/authorize';
import { assignServerRole, keepingARoleManager } from '../../permissions/grants';
import { commonSchemas, zValidator } from '../../utils/validation';
import { DEMO_USER_ID } from '../auth/demo-account';
import { attachPendingInvites } from '../shares/repository';
import { SIGNUP_MODES } from './policy';
import {
  createInvite,
  inviteStatus,
  listInvites,
  pendingAccounts,
  revokeInvite,
  signupSettings,
  updateSignupSettings,
} from './store';

const SERVER: ResourceOf = () => ({ kind: 'server' });

const settingsSchema = z
  .object({
    mode: z.enum(SIGNUP_MODES).optional(),
    allowedDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a domain like example.com')
      )
      .max(50)
      .optional(),
  })
  .strict();

const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    expiresInDays: z.number().int().min(1).max(CONFIG.signup.maxInviteTtlDays).optional(),
  })
  .strict();

function inviteView(invite: typeof serverInvites.$inferSelect, now: Date) {
  return {
    id: invite.id,
    email: invite.email,
    status: inviteStatus(invite, now),
    createdAt: invite.createdAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  };
}

async function pendingUser(tx: AsyncHandle, id: string) {
  const user = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, id), isNotNull(users.pendingApprovalAt)))
    .get();
  if (!user || user.id === DEMO_USER_ID) throw new NotFoundError('Waiting account');
  return user;
}

export const signupRoutes = new Hono();
signupRoutes.use('*', requireAuth);
signupRoutes.use('*', changeTracker);

signupRoutes.get('/signup', authorize(SERVER), async (c) =>
  c.json({ success: true, data: await signupSettings(appContext().asyncDb) })
);

signupRoutes.put('/signup', authorize(SERVER), zValidator('json', settingsSchema), async (c) => {
  const change = c.req.valid('json');
  const settings = await appContext().asyncDb.transaction((tx) =>
    updateSignupSettings(tx, change, c.get('user').id)
  );
  return c.json({ success: true, data: settings });
});

signupRoutes.get('/invites', authorize(SERVER), async (c) => {
  const now = new Date();
  const invites = await listInvites(appContext().asyncDb);
  return c.json({ success: true, data: invites.map((invite) => inviteView(invite, now)) });
});

signupRoutes.post('/invites', authorize(SERVER), zValidator('json', inviteSchema), async (c) => {
  const { email, expiresInDays } = c.req.valid('json');
  const now = new Date();
  const input = {
    email,
    expiresInDays: expiresInDays ?? CONFIG.signup.inviteTtlDays,
    createdBy: c.get('user').id,
  };
  const invite = await appContext().asyncDb.transaction((tx) => createInvite(tx, input, now));
  return c.json({ success: true, data: inviteView(invite, now) }, 201);
});

signupRoutes.delete(
  '/invites/:id',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  async (c) => {
    const now = new Date();
    const { id } = c.req.valid('param');
    const invite = await appContext().asyncDb.transaction((tx) => revokeInvite(tx, id, now));
    return c.json({ success: true, data: inviteView(invite, now) });
  }
);

signupRoutes.get('/pending-accounts', authorize(SERVER), async (c) => {
  const accounts = await pendingAccounts(appContext().asyncDb);
  return c.json({
    success: true,
    data: accounts.map((account) => ({
      ...account,
      pendingSince: account.pendingSince?.toISOString() ?? null,
    })),
  });
});

signupRoutes.post(
  '/pending-accounts/:id/approve',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  async (c) => {
    const id = await appContext().asyncDb.transaction(async (tx) => {
      const user = await pendingUser(tx, c.req.valid('param').id);
      await tx
        .update(users)
        .set({ pendingApprovalAt: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await assignServerRole(tx, user.id, 'member');
      await attachPendingInvites(tx, user.id, user.email);
      return user.id;
    });
    return c.json({ success: true, data: { id } });
  }
);

signupRoutes.delete(
  '/pending-accounts/:id',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  async (c) => {
    const id = await keepingARoleManager(appContext().asyncDb, async (tx) => {
      const user = await pendingUser(tx, c.req.valid('param').id);
      await tx.delete(users).where(and(eq(users.id, user.id), isNotNull(users.pendingApprovalAt)));
      return user.id;
    });
    return c.json({ success: true, data: { id } });
  }
);
