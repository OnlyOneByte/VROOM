import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { type VehicleShare, vehicleShares } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import type { ApiResponse } from '../../errors';
import {
  ConflictError,
  isUniqueConstraintError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { changeShareRole, endVehicleMembership, grantShareRole } from '../../permissions/grants';
import { commonSchemas, zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import {
  ACTIVE_SHARE_STATUSES,
  findInviteeId,
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

const ANY_STATUS = ['pending', 'accepted', 'declined', 'revoked'] as const;

function transitionShare(
  id: string,
  from: readonly string[],
  change: { status?: string; level?: string },
  then: (tx: DrizzleTransaction, before: VehicleShare, after: VehicleShare) => void
): VehicleShare {
  return getDb().transaction((tx) => {
    const before = tx.select().from(vehicleShares).where(eq(vehicleShares.id, id)).get();
    if (!before || !from.includes(before.status)) {
      throw new ConflictError('This share changed in the meantime. Reload and try again');
    }
    const after = tx
      .update(vehicleShares)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(vehicleShares.id, id))
      .returning()
      .get() as VehicleShare;
    then(tx, before, after);
    return after;
  });
}

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

  await requireVehicleAccess(vehicleId, user.id, 'owner');

  if (email === user.email.toLowerCase()) {
    throw new ValidationError('You cannot share a vehicle with yourself');
  }

  const inviteeId = await findInviteeId(getDb(), email);

  const alreadyShared = new ConflictError('This vehicle is already shared with that email');
  if (await vehicleShareRepository.findActiveInvite(vehicleId, email, inviteeId)) {
    throw alreadyShared;
  }

  const created = await vehicleShareRepository
    .create({
      vehicleId,
      ownerId: user.id,
      sharedWithId: inviteeId,
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

    const updated = transitionShare(id, ACTIVE_SHARE_STATUSES, { level }, (tx, _, row) => {
      if (row.status === 'accepted' && row.sharedWithId) {
        changeShareRole(tx, {
          vehicleId: row.vehicleId,
          sharedWithId: row.sharedWithId,
          level,
          grantedBy: user.id,
        });
      }
    });
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

  transitionShare(id, ANY_STATUS, { status: 'revoked' }, (tx, before) => {
    if (before.status === 'accepted' && before.sharedWithId) {
      endVehicleMembership(tx, before.vehicleId, before.sharedWithId);
    }
  });
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

  const updated = transitionShare(id, ['pending'], { status: 'accepted' }, (tx, _, row) => {
    endVehicleMembership(tx, row.vehicleId, user.id);
    grantShareRole(tx, {
      vehicleId: row.vehicleId,
      sharedWithId: user.id,
      level: row.level,
      grantedBy: row.ownerId,
    });
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

  transitionShare(id, ACTIVE_SHARE_STATUSES, { status: 'declined' }, (tx, before) => {
    if (before.status === 'accepted') endVehicleMembership(tx, before.vehicleId, user.id);
  });
  return c.json({ success: true, message: 'Share declined' });
});

export { routes };
