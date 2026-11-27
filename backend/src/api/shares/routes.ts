import { and, eq, notInArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import type { AsyncHandle, AsyncTransaction } from '../../db/async-sqlite';
import {
  permissionOverrides,
  roleAssignments,
  rolePermissions,
  users,
  type VehicleShare,
  vehicleShares,
  vehicles,
} from '../../db/schema';
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
  loadResolver,
  refuseUnheld,
  requestResolver,
  shareRoleId,
} from '../../permissions/grants';
import type { Resource } from '../../permissions/resolve';
import { ROLE_TEMPLATES } from '../../permissions/roles';
import { commonSchemas, zValidator } from '../../utils/validation';
import { carShareEnabled, ensureMemberDriver } from '../drivers/repository';
import {
  ACTIVE_SHARE_STATUSES,
  findInviteeId,
  type GrantedShare,
  isActiveShareStatus,
  type ReceivedShare,
  toOwnerView,
} from './repository';

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const LEVELS = ['viewer', 'editor'] as const;

const ANY_STATUS = ['pending', 'accepted', 'declined', 'revoked'] as const;

interface Transition {
  check?: (tx: AsyncTransaction, before: VehicleShare) => Promise<void>;
  afterwards: (tx: AsyncTransaction, before: VehicleShare, after: VehicleShare) => Promise<void>;
}

function transitionShare(
  id: string,
  from: readonly string[],
  change: { status?: string; level?: string },
  { check, afterwards }: Transition
): Promise<VehicleShare> {
  return appContext().asyncDb.transaction(async (tx) => {
    const before = await tx.select().from(vehicleShares).where(eq(vehicleShares.id, id)).get();
    if (!before || !from.includes(before.status)) {
      throw new ConflictError('This share changed in the meantime. Reload and try again');
    }
    await check?.(tx, before);
    const [after] = await tx
      .update(vehicleShares)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(vehicleShares.id, id))
      .returning();
    if (!after) throw new ConflictError('This share changed in the meantime. Reload and try again');
    await afterwards(tx, before, after);
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
  const share = await repos().vehicleShares.findById(c.req.param('id') ?? '');
  if (!share) throw new NotFoundError('Share');
  const vehicle: Resource = { kind: 'vehicle', vehicleId: share.vehicleId };
  const decision = (await loadResolver(c, [vehicle])).can('vehicle.read', vehicle);
  if (!decision.allow && decision.reason === 'not_found') throw new NotFoundError('Share');
  return vehicle;
};

async function vehicleOwnerId(tx: AsyncHandle, vehicleId: string): Promise<string | null> {
  const row = await tx
    .select({ userId: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
  return row?.userId ?? null;
}

function holdsOn(c: Context, vehicleId: string): (permission: string) => boolean {
  const resolver = requestResolver(c);
  const vehicle: Resource = { kind: 'vehicle', vehicleId };
  return (permission) => resolver.can(permission, vehicle).allow;
}

function refuseUnheldLevel(c: Context, vehicleId: string, level: string): void {
  const granted = ROLE_TEMPLATES.find((template) => template.key === level)?.permissions ?? [];
  refuseUnheld(granted, holdsOn(c, vehicleId));
}

async function refuseOverSharee(
  c: Context,
  tx: AsyncHandle,
  share: VehicleShare,
  ownerId: string | null,
  removesOverrides: boolean
): Promise<void> {
  if (!share.sharedWithId || !ownerId || c.get('user').id === ownerId) return;
  const heldRows = await tx
    .select({ permission: rolePermissions.permission })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(
        eq(roleAssignments.userId, share.sharedWithId),
        eq(roleAssignments.scopeId, share.vehicleId)
      )
    );
  const held = heldRows.map((row) => row.permission);
  refuseUnheld([...new Set(held)], holdsOn(c, share.vehicleId));
  const ownerSet = await tx
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
  const overrides = await tx
    .select({ permission: permissionOverrides.permission, setBy: permissionOverrides.setBy })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.userId, share.sharedWithId),
        eq(permissionOverrides.scope, 'vehicle'),
        eq(permissionOverrides.scopeId, share.vehicleId)
      )
    );
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

  const vehicle = await repos().vehicles.findById(vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  const owner = await appContext()
    .asyncDb.select({ email: users.email })
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

  const inviteeId = await findInviteeId(appContext().asyncDb, email);

  const alreadyShared = new ConflictError('This vehicle is already shared with that email');
  if (await repos().vehicleShares.findActiveInvite(vehicleId, email, inviteeId)) {
    throw alreadyShared;
  }

  const created = await repos()
    .vehicleShares.create({
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
  const shares = await repos().vehicleShares.findByOwner(user.id);
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

    const share = await repos().vehicleShares.findById(id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (!isActiveShareStatus(share.status)) {
      throw new ConflictError('This share is no longer active');
    }
    refuseUnheldLevel(c, share.vehicleId, level);

    let ownerId: string | null = null;
    const updated = await transitionShare(
      id,
      ACTIVE_SHARE_STATUSES,
      { level },
      {
        check: async (tx, before) => {
          if (before.sharedWithId === user.id) {
            throw new ForbiddenError("You can't change your own access");
          }
          ownerId = await vehicleOwnerId(tx, before.vehicleId);
          await refuseOverSharee(c, tx, before, ownerId, false);
        },
        afterwards: async (tx, _, row) => {
          if (row.status === 'accepted' && row.sharedWithId) {
            await changeShareRole(tx, {
              vehicleId: row.vehicleId,
              sharedWithId: row.sharedWithId,
              level,
              grantedBy: ownerId ?? user.id,
            });
          }
        },
      }
    );
    return c.json({ success: true, data: toOwnerView(updated), message: 'Share level updated' });
  }
);

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  authorize(fromShare),
  async (c) => {
    const { id } = c.req.valid('param');
    await transitionShare(
      id,
      ANY_STATUS,
      { status: 'revoked' },
      {
        check: async (tx, before) => {
          if (before.sharedWithId === c.get('user').id) {
            throw new ForbiddenError('To leave this vehicle, decline the share');
          }
          await refuseOverSharee(c, tx, before, await vehicleOwnerId(tx, before.vehicleId), true);
        },
        afterwards: async (tx, before) => {
          if (before.status === 'accepted' && before.sharedWithId) {
            await endVehicleMembership(tx, before.vehicleId, before.sharedWithId);
          }
        },
      }
    );
    return c.json({ success: true, message: 'Share revoked' });
  }
);

routes.get('/received', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const shares = await repos().vehicleShares.findReceivedByUser(user.id);
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

    const share = await repos().vehicleShares.findByIdAndSharedWith(id, user.id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (share.status !== 'pending') {
      throw new ConflictError('This invitation is no longer pending');
    }

    const updated = await transitionShare(
      id,
      ['pending'],
      { status: 'accepted' },
      {
        afterwards: async (tx, _, row) => {
          await endVehicleMembership(tx, row.vehicleId, user.id);
          await grantShareRole(tx, {
            vehicleId: row.vehicleId,
            sharedWithId: user.id,
            level: row.level,
            grantedBy: row.ownerId,
          });
          if (await carShareEnabled(tx, row.vehicleId)) {
            await ensureMemberDriver(tx, row.vehicleId, user.id);
          }
        },
      }
    );
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

    const share = await repos().vehicleShares.findByIdAndSharedWith(id, user.id);
    if (!share) {
      throw new NotFoundError('Share');
    }
    if (share.status !== 'pending' && share.status !== 'accepted') {
      throw new ConflictError('This share is no longer active');
    }

    await transitionShare(
      id,
      ACTIVE_SHARE_STATUSES,
      { status: 'declined' },
      {
        afterwards: async (tx, before) => {
          if (before.status === 'accepted')
            await endVehicleMembership(tx, before.vehicleId, user.id);
        },
      }
    );
    return c.json({ success: true, message: 'Share declined' });
  }
);

export { routes };
