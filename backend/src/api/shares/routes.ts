import { and, eq, notInArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import {
  permissionOverrides,
  roleAssignments,
  rolePermissions,
  users,
  type VehicleShare,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import type { ApiResponse } from '../../errors';
import {
  ConflictError,
  ForbiddenError,
  isUniqueConstraintError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, ownAccount, type ResourceOf } from '../../permissions/authorize';
import {
  changeShareRole,
  endVehicleMembership,
  grantShareRole,
  refuseUnheld,
  requestResolver,
  shareRoleId,
} from '../../permissions/grants';
import type { Resource } from '../../permissions/resolve';
import { ROLE_TEMPLATES } from '../../permissions/roles';
import { commonSchemas, zValidator } from '../../utils/validation';
import { carShareEnabled, ensureMemberDriver } from '../drivers/repository';
import { vehicleRepository } from '../vehicles/repository';
import {
  ACTIVE_SHARE_STATUSES,
  findInviteeId,
  type GrantedShare,
  isActiveShareStatus,
  type ReceivedShare,
  toOwnerView,
  vehicleShareRepository,
} from './repository';

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

const fromInviteVehicle: ResourceOf = (c) => ({
  kind: 'vehicle',
  vehicleId: (c.req.valid('json' as never) as { vehicleId: string }).vehicleId,
});

const fromShare: ResourceOf = async (c) => {
  const share = await vehicleShareRepository.findById(c.req.param('id') ?? '');
  if (!share) throw new NotFoundError('Share');
  const vehicle: Resource = { kind: 'vehicle', vehicleId: share.vehicleId };
  const decision = requestResolver(c, getDb()).can('vehicle.read', vehicle);
  if (!decision.allow && decision.reason === 'not_found') throw new NotFoundError('Share');
  return vehicle;
};

function vehicleOwnerId(vehicleId: string): string | null {
  const row = getDb()
    .select({ userId: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
  return row?.userId ?? null;
}

function holdsOn(c: Context, vehicleId: string): (permission: string) => boolean {
  const resolver = requestResolver(c, getDb());
  const vehicle: Resource = { kind: 'vehicle', vehicleId };
  return (permission) => resolver.can(permission, vehicle).allow;
}

function refuseUnheldLevel(c: Context, vehicleId: string, level: string): void {
  const granted = ROLE_TEMPLATES.find((template) => template.key === level)?.permissions ?? [];
  refuseUnheld(granted, holdsOn(c, vehicleId));
}

function refuseOverSharee(
  c: Context,
  share: VehicleShare,
  ownerId: string | null,
  removesOverrides: boolean
): void {
  if (!share.sharedWithId || !ownerId || c.get('user').id === ownerId) return;
  const held = getDb()
    .select({ permission: rolePermissions.permission })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(
        eq(roleAssignments.userId, share.sharedWithId),
        eq(roleAssignments.scopeId, share.vehicleId)
      )
    )
    .all()
    .map((row) => row.permission);
  refuseUnheld([...new Set(held)], holdsOn(c, share.vehicleId));
  const ownerSet = getDb()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, share.sharedWithId),
        eq(roleAssignments.scopeId, share.vehicleId),
        eq(roleAssignments.grantedBy, ownerId),
        notInArray(roleAssignments.roleId, [shareRoleId('editor'), shareRoleId('viewer')])
      )
    )
    .get();
  if (ownerSet) throw new ForbiddenError('Only the owner can change what the owner set');
  if (!removesOverrides) return;
  const overrides = getDb()
    .select({ permission: permissionOverrides.permission, setBy: permissionOverrides.setBy })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.userId, share.sharedWithId),
        eq(permissionOverrides.scope, 'vehicle'),
        eq(permissionOverrides.scopeId, share.vehicleId)
      )
    )
    .all();
  refuseUnheld(
    [...new Set(overrides.map((override) => override.permission))],
    holdsOn(c, share.vehicleId)
  );
  if (overrides.some((override) => override.setBy === ownerId)) {
    throw new ForbiddenError('Only the owner can change what the owner set');
  }
}

routes.post('/', zValidator('json', inviteSchema), authorize(fromInviteVehicle), async (c) => {
  const user = c.get('user');
  const { vehicleId, level } = c.req.valid('json');
  const email = c.req.valid('json').email.trim().toLowerCase();

  const vehicle = await vehicleRepository.findById(vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  const owner = getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, vehicle.userId))
    .get();

  if (email === user.email.toLowerCase()) {
    throw new ValidationError('You cannot share a vehicle with yourself');
  }
  if (email === owner?.email.toLowerCase()) {
    throw new ValidationError('The owner already has access to this vehicle');
  }
  refuseUnheldLevel(c, vehicleId, level);

  const inviteeId = await findInviteeId(getDb(), email);

  const alreadyShared = new ConflictError('This vehicle is already shared with that email');
  if (await vehicleShareRepository.findActiveInvite(vehicleId, email, inviteeId)) {
    throw alreadyShared;
  }

  const created = await vehicleShareRepository
    .create({
      vehicleId,
      ownerId: vehicle.userId,
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

routes.get('/granted', authorize(ownAccount), async (c) => {
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
  authorize(fromShare),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { level } = c.req.valid('json');

    const share = await vehicleShareRepository.findById(id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (!isActiveShareStatus(share.status)) {
      throw new ConflictError('This share is no longer active');
    }
    if (share.sharedWithId === user.id) {
      throw new ForbiddenError("You can't change your own access");
    }
    const ownerId = vehicleOwnerId(share.vehicleId);
    refuseUnheldLevel(c, share.vehicleId, level);
    refuseOverSharee(c, share, ownerId, false);

    const updated = transitionShare(id, ACTIVE_SHARE_STATUSES, { level }, (tx, _, row) => {
      if (row.status === 'accepted' && row.sharedWithId) {
        changeShareRole(tx, {
          vehicleId: row.vehicleId,
          sharedWithId: row.sharedWithId,
          level,
          grantedBy: ownerId ?? user.id,
        });
      }
    });
    return c.json({ success: true, data: toOwnerView(updated), message: 'Share level updated' });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(fromShare),
  async (c) => {
    const { id } = c.req.valid('param');

    const share = await vehicleShareRepository.findById(id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (share.sharedWithId === c.get('user').id) {
      throw new ForbiddenError('To leave this vehicle, decline the share');
    }
    refuseOverSharee(c, share, vehicleOwnerId(share.vehicleId), true);

    transitionShare(id, ANY_STATUS, { status: 'revoked' }, (tx, before) => {
      if (before.status === 'accepted' && before.sharedWithId) {
        endVehicleMembership(tx, before.vehicleId, before.sharedWithId);
      }
    });
    return c.json({ success: true, message: 'Share revoked' });
  }
);

routes.get('/received', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const shares = await vehicleShareRepository.findReceivedByUser(user.id);
  const response: ApiResponse<ReceivedShare[]> = {
    success: true,
    data: shares,
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };
  return c.json(response);
});

routes.post(
  '/:id/accept',
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
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
      if (carShareEnabled(tx, row.vehicleId)) ensureMemberDriver(tx, row.vehicleId, user.id);
    });
    return c.json({ success: true, data: updated, message: 'Invitation accepted' });
  }
);

routes.post(
  '/:id/decline',
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
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
  }
);

export { routes };
