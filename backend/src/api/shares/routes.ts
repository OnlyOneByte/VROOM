import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { users, type VehicleShare } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { commonSchemas, validateVehicleOwnership, zValidator } from '../../utils/validation';
import { type ReceivedShare, vehicleShareRepository } from './repository';

// Share management. Owner actions check strict vehicle ownership: an editor or viewer cannot manage shares.

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

routes.post('/', zValidator('json', inviteSchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, email, level } = c.req.valid('json');

  // Every rejection happens before the insert.
  await validateVehicleOwnership(vehicleId, user.id);

  // Only existing accounts can be invited.
  const db = getDb();
  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!invitee) {
    throw new NotFoundError('No VROOM account with that email');
  }

  if (invitee.id === user.id) {
    throw new ValidationError('You cannot share a vehicle with yourself');
  }

  // Checked here for a clean 409; the partial unique index enforces the same rule. Declined and revoked
  // shares do not block a new invite.
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
    data: created,
    message: 'Invitation sent',
  };
  return c.json(response, 201);
});

routes.get('/granted', async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findByOwner(user.id);
  const response: ApiResponse<VehicleShare[]> = {
    success: true,
    data: shares,
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };
  return c.json(response);
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', levelSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { level } = c.req.valid('json');

    // Non-owners get the same 404 as a missing share.
    const share = await vehicleShareRepository.findByIdAndOwner(id, user.id);
    if (!share) {
      throw new NotFoundError('Share');
    }

    const updated = await vehicleShareRepository.update(id, { level, updatedAt: new Date() });
    return c.json({ success: true, data: updated, message: 'Share level updated' });
  }
);

// The row is kept and only its status changes, so the active slot frees up and re-invites work.
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

// Invitee actions key on sharedWithId. Anyone else gets the same 404 as a missing share.
routes.get('/received', async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findReceivedByUser(user.id);
  const response: ApiResponse<ReceivedShare[]> = {
    success: true,
    data: shares,
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };
  return c.json(response);
});

routes.post('/:id/accept', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const share = await vehicleShareRepository.findByIdAndSharedWith(id, user.id);
  if (!share) {
    throw new NotFoundError('Share');
  }
  // Only pending invites can be accepted, so a stale accept cannot revive a share the owner revoked.
  if (share.status !== 'pending') {
    throw new ConflictError('This invitation is no longer pending');
  }

  const updated = await vehicleShareRepository.update(id, {
    status: 'accepted',
    updatedAt: new Date(),
  });
  return c.json({ success: true, data: updated, message: 'Invitation accepted' });
});

// Declining a pending invite or leaving an accepted share both set the status to declined.
routes.post('/:id/decline', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const share = await vehicleShareRepository.findByIdAndSharedWith(id, user.id);
  if (!share) {
    throw new NotFoundError('Share');
  }
  if (share.status !== 'pending' && share.status !== 'accepted') {
    throw new ConflictError('This share is no longer active');
  }

  await vehicleShareRepository.update(id, { status: 'declined', updatedAt: new Date() });
  return c.json({ success: true, message: 'Share declined' });
});

export { routes };
