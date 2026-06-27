import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { users, type VehicleShare } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { commonSchemas, validateVehicleOwnership } from '../../utils/validation';
import { vehicleShareRepository } from './repository';

/**
 * Vehicle-sharing — OWNER-side share-management routes (T3, `/api/v1/shares`). The owner invites
 * another existing VROOM user (by email) to ONE of their vehicles, lists shares they granted, changes
 * a share's level, or revokes it. EVERY owner-side action gates on the STRICT `validateVehicleOwnership`
 * (owner === acting via vehicles.userId) — managing shares is an owner-only action, NOT something an
 * editor/viewer can do, so it never uses the requireVehicleWrite seam. Invitee-side accept/decline is T4.
 *
 * Cross-tenant discipline (R6): the IDOR sweep proves a non-owner cannot invite to / list / change /
 * revoke a share on someone else's vehicle — see cross-tenant-idor.test.ts (shares entries, same cycle).
 */

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const LEVELS = ['viewer', 'editor'] as const;

const inviteSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  email: z.string().email('A valid invitee email is required'),
  level: z.enum(LEVELS),
});

const levelSchema = z.object({ level: z.enum(LEVELS) });

/** Owner-facing share view: the raw row is already owner-safe (no cross-tenant data); returned as-is. */
function shareToApi(share: VehicleShare): VehicleShare {
  return share;
}

// POST /api/v1/shares — invite an existing user to a vehicle I own (→ pending). R1.
routes.post('/', zValidator('json', inviteSchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, email, level } = c.req.valid('json');

  // Owner-only: the vehicle must be the acting user's own (404 if not — never leaks existence). This is
  // the C151 validate-before-insert order: every rejection throws BEFORE any row write.
  await validateVehicleOwnership(vehicleId, user.id);

  // Invitee must be an existing VROOM user (D4 — no email-signup invites in v1).
  const db = getDb();
  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!invitee) {
    throw new NotFoundError('No VROOM account with that email');
  }

  // Cannot share a vehicle with yourself (you are already the owner).
  if (invitee.id === user.id) {
    throw new ValidationError('You cannot share a vehicle with yourself');
  }

  // One ACTIVE (pending|accepted) share per (vehicle, invitee) — mirrors the partial-unique DB index,
  // but checked here first so the user gets a clean 409 instead of a raw constraint error. A prior
  // declined/revoked share does NOT block a fresh invite (the partial index excludes those).
  const existing = await vehicleShareRepository.findActiveForVehicleAndUser(vehicleId, invitee.id);
  if (existing) {
    throw new ConflictError('This vehicle is already shared with that user');
  }

  const created = await vehicleShareRepository.create({
    vehicleId,
    ownerId: user.id,
    sharedWithId: invitee.id,
    level,
    status: 'pending',
  });

  const response: ApiResponse<VehicleShare> = {
    success: true,
    data: shareToApi(created),
    message: 'Invitation sent',
  };
  return c.json(response, 201);
});

// GET /api/v1/shares/granted — every share I granted, across all my vehicles. R5.
routes.get('/granted', async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findByOwner(user.id);
  const response: ApiResponse<VehicleShare[]> = {
    success: true,
    data: shares.map(shareToApi),
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };
  return c.json(response);
});

// PUT /api/v1/shares/:id — change a share's level (owner of the share's vehicle only). R5.
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', levelSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { level } = c.req.valid('json');

    // Scope by ownerId: a non-owner gets the same 404 a nonexistent share does (existence-hiding).
    const share = await vehicleShareRepository.findByIdAndOwner(id, user.id);
    if (!share) {
      throw new NotFoundError('Share');
    }

    const updated = await vehicleShareRepository.update(id, { level, updatedAt: new Date() });
    return c.json({ success: true, data: shareToApi(updated), message: 'Share level updated' });
  }
);

// DELETE /api/v1/shares/:id — revoke a share (→ revoked; D8). The row is kept (status flip), so the
// partial-unique slot frees and the same user can be re-invited later. R5.
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const share = await vehicleShareRepository.findByIdAndOwner(id, user.id);
  if (!share) {
    throw new NotFoundError('Share');
  }

  await vehicleShareRepository.update(id, { status: 'revoked', updatedAt: new Date() });
  return c.json({ success: true, message: 'Share revoked' });
});

// ---------------------------------------------------------------------------
// Invitee-side endpoints (T4). Every action is scoped to `sharedWithId === acting` — only the invitee
// can act on their OWN invite (a third party gets the same 404 a nonexistent share does, R2/R6).
// ---------------------------------------------------------------------------

// GET /api/v1/shares/received — invites/grants TO me (pending + accepted). R5.
routes.get('/received', async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findReceivedByUser(user.id);
  const response: ApiResponse<VehicleShare[]> = {
    success: true,
    data: shares.map(shareToApi),
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };
  return c.json(response);
});

// POST /api/v1/shares/:id/accept — invitee accepts a PENDING invite (→ accepted). R2.
routes.post('/:id/accept', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Scope by sharedWithId: only the invitee can accept; anyone else gets the same 404 (existence-hiding).
  const share = await vehicleShareRepository.findByIdAndSharedWith(id, user.id);
  if (!share) {
    throw new NotFoundError('Share');
  }
  // Only a PENDING invite can be accepted — a declined/revoked one is inert, an accepted one is a no-op
  // that should not silently "re-activate" something the owner may have since revoked. Reject non-pending.
  if (share.status !== 'pending') {
    throw new ConflictError('This invitation is no longer pending');
  }

  const updated = await vehicleShareRepository.update(id, {
    status: 'accepted',
    updatedAt: new Date(),
  });
  return c.json({ success: true, data: shareToApi(updated), message: 'Invitation accepted' });
});

// POST /api/v1/shares/:id/decline — invitee declines a pending invite OR self-removes an accepted
// share (both → declined; D5/R5). Frees the partial-unique active slot so the owner can re-invite. R2.
routes.post('/:id/decline', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const share = await vehicleShareRepository.findByIdAndSharedWith(id, user.id);
  if (!share) {
    throw new NotFoundError('Share');
  }
  // Decline works from pending (reject the invite) OR accepted (self-remove). An already
  // declined/revoked share is inert — nothing to do (reject as a conflict so the client is not misled).
  if (share.status !== 'pending' && share.status !== 'accepted') {
    throw new ConflictError('This share is no longer active');
  }

  await vehicleShareRepository.update(id, { status: 'declined', updatedAt: new Date() });
  return c.json({ success: true, message: 'Share declined' });
});

export { routes };
