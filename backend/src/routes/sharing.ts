import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { NewVehicleShare } from '../db/schema';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/errors';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';
import type { ApiResponse } from '../types/api';

const sharing = new Hono();

// Validation schemas
const createShareSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  sharedWithEmail: z.string().email('Valid email is required'),
  permission: z.enum(['view', 'edit'], {
    message: 'Permission must be either "view" or "edit"',
  }),
});

const updateShareStatusSchema = z.object({
  status: z.enum(['accepted', 'declined'], {
    message: 'Status must be either "accepted" or "declined"',
  }),
});

const shareParamsSchema = z.object({
  id: z.string().min(1, 'Share ID is required'),
});

const vehicleParamsSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
});

// Apply authentication to all routes
sharing.use('*', requireAuth);

// POST /api/sharing - Create a new vehicle share invitation
sharing.post('/', zValidator('json', createShareSchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, sharedWithEmail, permission } = c.req.valid('json');

  const vehicleRepository = repositoryFactory.getVehicleRepository();
  const userRepository = repositoryFactory.getUserRepository();
  const shareRepository = repositoryFactory.getVehicleShareRepository();

  // Check if vehicle exists and belongs to the user
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  // Find the user to share with
  const sharedWithUser = await userRepository.findByEmail(sharedWithEmail);
  if (!sharedWithUser) {
    throw new NotFoundError('User with this email');
  }

  // Prevent sharing with self
  if (sharedWithUser.id === user.id) {
    throw new ConflictError('Cannot share vehicle with yourself');
  }

  // Check if already shared with this user
  const existingShare = await shareRepository.findByVehicleAndUser(vehicleId, sharedWithUser.id);
  if (existingShare) {
    if (existingShare.status === 'pending') {
      throw new ConflictError('A pending invitation already exists for this user');
    }
    if (existingShare.status === 'accepted') {
      throw new ConflictError('Vehicle is already shared with this user');
    }
    // If declined, we can create a new invitation
  }

  const newShare: NewVehicleShare = {
    vehicleId,
    ownerId: user.id,
    sharedWithUserId: sharedWithUser.id,
    permission,
    status: 'pending',
  };

  const createdShare = await shareRepository.create(newShare);

  const response: ApiResponse<typeof createdShare> = {
    success: true,
    data: createdShare,
    message: `Vehicle sharing invitation sent to ${sharedWithEmail}`,
  };

  return c.json(response, 201);
});

// GET /api/sharing/invitations - Get pending invitations for current user
sharing.get('/invitations', async (c) => {
  const user = c.get('user');
  const shareRepository = repositoryFactory.getVehicleShareRepository();
  const vehicleRepository = repositoryFactory.getVehicleRepository();
  const userRepository = repositoryFactory.getUserRepository();

  const invitations = await shareRepository.findPendingInvitations(user.id);

  // Enrich invitations with vehicle and owner details
  const enrichedInvitations = await Promise.all(
    invitations.map(async (invitation) => {
      const vehicle = await vehicleRepository.findById(invitation.vehicleId);
      const owner = await userRepository.findById(invitation.ownerId);

      return {
        ...invitation,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year,
              nickname: vehicle.nickname,
            }
          : null,
        owner: owner
          ? {
              id: owner.id,
              displayName: owner.displayName,
              email: owner.email,
            }
          : null,
      };
    })
  );

  const response: ApiResponse<typeof enrichedInvitations> = {
    success: true,
    data: enrichedInvitations,
    message: `Found ${invitations.length} pending invitation${invitations.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// GET /api/sharing/sent - Get shares created by current user
sharing.get('/sent', async (c) => {
  const user = c.get('user');
  const shareRepository = repositoryFactory.getVehicleShareRepository();
  const vehicleRepository = repositoryFactory.getVehicleRepository();
  const userRepository = repositoryFactory.getUserRepository();

  const shares = await shareRepository.findByOwnerId(user.id);

  // Enrich shares with vehicle and shared user details
  const enrichedShares = await Promise.all(
    shares.map(async (share) => {
      const vehicle = await vehicleRepository.findById(share.vehicleId);
      const sharedWithUser = await userRepository.findById(share.sharedWithUserId);

      return {
        ...share,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year,
              nickname: vehicle.nickname,
            }
          : null,
        sharedWith: sharedWithUser
          ? {
              id: sharedWithUser.id,
              displayName: sharedWithUser.displayName,
              email: sharedWithUser.email,
            }
          : null,
      };
    })
  );

  const response: ApiResponse<typeof enrichedShares> = {
    success: true,
    data: enrichedShares,
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// GET /api/sharing/received - Get vehicles shared with current user
sharing.get('/received', async (c) => {
  const user = c.get('user');
  const shareRepository = repositoryFactory.getVehicleShareRepository();
  const vehicleRepository = repositoryFactory.getVehicleRepository();
  const userRepository = repositoryFactory.getUserRepository();

  const shares = await shareRepository.findBySharedWithUserId(user.id);

  // Filter only accepted shares
  const acceptedShares = shares.filter((share) => share.status === 'accepted');

  // Enrich shares with vehicle and owner details
  const enrichedShares = await Promise.all(
    acceptedShares.map(async (share) => {
      const vehicle = await vehicleRepository.findById(share.vehicleId);
      const owner = await userRepository.findById(share.ownerId);

      return {
        ...share,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year,
              nickname: vehicle.nickname,
            }
          : null,
        owner: owner
          ? {
              id: owner.id,
              displayName: owner.displayName,
              email: owner.email,
            }
          : null,
      };
    })
  );

  const response: ApiResponse<typeof enrichedShares> = {
    success: true,
    data: enrichedShares,
    message: `Found ${acceptedShares.length} shared vehicle${acceptedShares.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// GET /api/sharing/vehicle/:vehicleId - Get all shares for a specific vehicle
sharing.get('/vehicle/:vehicleId', zValidator('param', vehicleParamsSchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('param');

  const vehicleRepository = repositoryFactory.getVehicleRepository();
  const shareRepository = repositoryFactory.getVehicleShareRepository();
  const userRepository = repositoryFactory.getUserRepository();

  // Check if user owns the vehicle
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
  if (!vehicle) {
    throw new ForbiddenError('You do not have permission to view shares for this vehicle');
  }

  const shares = await shareRepository.findByVehicleId(vehicleId);

  // Enrich shares with shared user details
  const enrichedShares = await Promise.all(
    shares.map(async (share) => {
      const sharedWithUser = await userRepository.findById(share.sharedWithUserId);

      return {
        ...share,
        sharedWith: sharedWithUser
          ? {
              id: sharedWithUser.id,
              displayName: sharedWithUser.displayName,
              email: sharedWithUser.email,
            }
          : null,
      };
    })
  );

  const response: ApiResponse<typeof enrichedShares> = {
    success: true,
    data: enrichedShares,
    message: `Found ${shares.length} share${shares.length !== 1 ? 's' : ''} for this vehicle`,
  };

  return c.json(response);
});

// PUT /api/sharing/:id/status - Accept or decline a share invitation
sharing.put(
  '/:id/status',
  zValidator('param', shareParamsSchema),
  zValidator('json', updateShareStatusSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');

    const shareRepository = repositoryFactory.getVehicleShareRepository();

    // Check if share exists
    const share = await shareRepository.findById(id);
    if (!share) {
      throw new NotFoundError('Share invitation');
    }

    // Check if user is the recipient
    if (share.sharedWithUserId !== user.id) {
      throw new ForbiddenError('You can only respond to invitations sent to you');
    }

    // Check if already responded
    if (share.status !== 'pending') {
      throw new ConflictError(`This invitation has already been ${share.status}`);
    }

    const updatedShare = await shareRepository.updateStatus(id, status);

    const response: ApiResponse<typeof updatedShare> = {
      success: true,
      data: updatedShare,
      message: `Share invitation ${status}`,
    };

    return c.json(response);
  }
);

// DELETE /api/sharing/:id - Remove a share (owner only)
sharing.delete('/:id', zValidator('param', shareParamsSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const shareRepository = repositoryFactory.getVehicleShareRepository();

  // Check if share exists
  const share = await shareRepository.findById(id);
  if (!share) {
    throw new NotFoundError('Share');
  }

  // Check if user is the owner or the shared user
  if (share.ownerId !== user.id && share.sharedWithUserId !== user.id) {
    throw new ForbiddenError('You do not have permission to remove this share');
  }

  await shareRepository.delete(id);

  const response: ApiResponse<null> = {
    success: true,
    data: null,
    message: 'Share removed successfully',
  };

  return c.json(response);
});

export { sharing };
