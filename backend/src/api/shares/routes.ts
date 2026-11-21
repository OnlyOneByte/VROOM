import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { users } from '../../db/schema';
import type { ApiResponse } from '../../errors';
import {
  ConflictError,
  isUniqueConstraintError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { commonSchemas, validateVehicleOwnership, zValidator } from '../../utils/validation';
import {
  type GrantedShare,
  isActiveShareStatus,
  type ReceivedShare,
  toOwnerView,
  vehicleShareRepository,
} from './repository';

// Non-owners and non-invitees get 404, not 403, so share existence is not revealed.

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
  const { vehicleId, level } = c.req.valid('json');
  const email = c.req.valid('json').email.trim().toLowerCase();

  await validateVehicleOwnership(vehicleId, user.id);

  if (email === user.email.toLowerCase()) {
    throw new ValidationError('You cannot share a vehicle with yourself');
  }

  const db = getDb();
  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  const alreadyShared = new ConflictError('This vehicle is already shared with that email');
  if (await vehicleShareRepository.findActiveInvite(vehicleId, email, invitee?.id ?? null)) {
    throw alreadyShared;
  }

  const created = await vehicleShareRepository
    .create({
      vehicleId,
      ownerId: user.id,
      sharedWithId: invitee?.id ?? null,
      level,
      status: 'pending',
      invitedEmail: email,
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) throw alreadyShared;
      throw error;
    });

  const response: ApiResponse<GrantedShare> = {
    success: true,
    data: toOwnerView(created),
    message: 'Invitation sent. They will see it when they sign in to VROOM with that email.',
  };
  return c.json(response, 201);
});

routes.get('/granted', async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findByOwner(user.id);
  const response: ApiResponse<GrantedShare[]> = {
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

    const share = await vehicleShareRepository.findByIdAndOwner(id, user.id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (!isActiveShareStatus(share.status)) {
      throw new ConflictError('This share is no longer active');
    }

    const updated = await vehicleShareRepository.update(id, { level, updatedAt: new Date() });
    return c.json({ success: true, data: toOwnerView(updated), message: 'Share level updated' });
  }
);

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
  if (share.status !== 'pending') {
    throw new ConflictError('This invitation is no longer pending');
  }

  const updated = await vehicleShareRepository.update(id, {
    status: 'accepted',
    updatedAt: new Date(),
  });
  return c.json({ success: true, data: updated, message: 'Invitation accepted' });
});

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
