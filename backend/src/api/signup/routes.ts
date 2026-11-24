import { and, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { type serverInvites, users } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, type ResourceOf } from '../../permissions/authorize';
import { assignServerRole } from '../../permissions/grants';
import { commonSchemas, zValidator } from '../../utils/validation';
import { DEMO_USER_ID } from '../auth/demo-account';
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

function pendingUser(id: string) {
  const user = getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), isNotNull(users.pendingApprovalAt)))
    .get();
  if (!user || user.id === DEMO_USER_ID) throw new NotFoundError('Waiting account');
  return user;
}

export const signupRoutes = new Hono();
signupRoutes.use('*', requireAuth);
signupRoutes.use('*', changeTracker);

signupRoutes.get('/signup', authorize(SERVER), (c) =>
  c.json({ success: true, data: signupSettings(getDb()) })
);

signupRoutes.put('/signup', authorize(SERVER), zValidator('json', settingsSchema), (c) => {
  const settings = updateSignupSettings(getDb(), c.req.valid('json'), c.get('user').id);
  return c.json({ success: true, data: settings });
});

signupRoutes.get('/invites', authorize(SERVER), (c) => {
  const now = new Date();
  return c.json({
    success: true,
    data: listInvites(getDb()).map((invite) => inviteView(invite, now)),
  });
});

signupRoutes.post('/invites', authorize(SERVER), zValidator('json', inviteSchema), (c) => {
  const { email, expiresInDays } = c.req.valid('json');
  const now = new Date();
  const invite = createInvite(
    getDb(),
    {
      email,
      expiresInDays: expiresInDays ?? CONFIG.signup.inviteTtlDays,
      createdBy: c.get('user').id,
    },
    now
  );
  return c.json({ success: true, data: inviteView(invite, now) }, 201);
});

signupRoutes.delete(
  '/invites/:id',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  (c) => {
    const now = new Date();
    const invite = revokeInvite(getDb(), c.req.valid('param').id, now);
    return c.json({ success: true, data: inviteView(invite, now) });
  }
);

signupRoutes.get('/pending-accounts', authorize(SERVER), (c) =>
  c.json({
    success: true,
    data: pendingAccounts(getDb()).map((account) => ({
      ...account,
      pendingSince: account.pendingSince?.toISOString() ?? null,
    })),
  })
);

signupRoutes.post(
  '/pending-accounts/:id/approve',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  (c) => {
    const { id } = pendingUser(c.req.valid('param').id);
    getDb().transaction((tx) => {
      tx.update(users)
        .set({ pendingApprovalAt: null, updatedAt: new Date() })
        .where(eq(users.id, id))
        .run();
      assignServerRole(tx, id, 'member');
    });
    return c.json({ success: true, data: { id } });
  }
);

signupRoutes.delete(
  '/pending-accounts/:id',
  authorize(SERVER),
  zValidator('param', commonSchemas.idParam),
  (c) => {
    const { id } = pendingUser(c.req.valid('param').id);
    getDb()
      .delete(users)
      .where(and(eq(users.id, id), isNotNull(users.pendingApprovalAt)))
      .run();
    return c.json({ success: true, data: { id } });
  }
);
