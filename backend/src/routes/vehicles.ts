import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { NewVehicle } from '../db/schema';
import { AuthorizationError, ConflictError, NotFoundError } from '../lib/errors';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';
import type { ApiResponse } from '../types/api';

const vehicles = new Hono();

// Validation schemas
const createVehicleSchema = z.object({
  make: z.string().min(1, 'Make is required').max(50, 'Make must be 50 characters or less'),
  model: z.string().min(1, 'Model is required').max(50, 'Model must be 50 characters or less'),
  year: z
    .number()
    .int()
    .min(1900, 'Year must be 1900 or later')
    .max(new Date().getFullYear() + 1, 'Year cannot be in the future'),
  licensePlate: z.string().max(20, 'License plate must be 20 characters or less').optional(),
  nickname: z.string().max(50, 'Nickname must be 50 characters or less').optional(),
  initialMileage: z.number().int().min(0, 'Initial mileage cannot be negative').optional(),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative').optional(),
  purchaseDate: z.coerce.date().optional(),
});

const updateVehicleSchema = createVehicleSchema.partial();

const vehicleParamsSchema = z.object({
  id: z.string().min(1, 'Vehicle ID is required'),
});

// Apply authentication to all routes
vehicles.use('*', requireAuth);

// GET /api/vehicles - List user's vehicles (including shared)
vehicles.get('/', async (c) => {
  const user = c.get('user');
  const vehicleRepository = repositoryFactory.getVehicleRepository();

  const userVehicles = await vehicleRepository.findAccessibleVehicles(user.id);

  const response: ApiResponse<typeof userVehicles> = {
    success: true,
    data: userVehicles,
    message: `Found ${userVehicles.length} vehicle${userVehicles.length !== 1 ? 's' : ''}`,
  };

  return c.json(response);
});

// POST /api/vehicles - Create new vehicle
vehicles.post('/', zValidator('json', createVehicleSchema), async (c) => {
  const user = c.get('user');
  const vehicleData = c.req.valid('json');
  const vehicleRepository = repositoryFactory.getVehicleRepository();

  // Check if license plate already exists (if provided)
  if (vehicleData.licensePlate) {
    const existingVehicle = await vehicleRepository.findByLicensePlate(vehicleData.licensePlate);
    if (existingVehicle) {
      throw new ConflictError('A vehicle with this license plate already exists');
    }
  }

  const newVehicle: NewVehicle = {
    ...vehicleData,
    userId: user.id,
  };

  const createdVehicle = await vehicleRepository.create(newVehicle);

  const response: ApiResponse<typeof createdVehicle> = {
    success: true,
    data: createdVehicle,
    message: 'Vehicle created successfully',
  };

  return c.json(response, 201);
});

// GET /api/vehicles/:id - Get specific vehicle (with shared access)
vehicles.get('/:id', zValidator('param', vehicleParamsSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const vehicleRepository = repositoryFactory.getVehicleRepository();

  const vehicle = await vehicleRepository.findByIdWithAccess(id, user.id);

  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  const response: ApiResponse<typeof vehicle> = {
    success: true,
    data: vehicle,
  };

  return c.json(response);
});

// PUT /api/vehicles/:id - Update vehicle (with shared access check)
vehicles.put(
  '/:id',
  zValidator('param', vehicleParamsSchema),
  zValidator('json', updateVehicleSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const shareRepository = repositoryFactory.getVehicleShareRepository();

    // Check if vehicle exists and user has access
    const existingVehicle = await vehicleRepository.findByIdWithAccess(id, user.id);
    if (!existingVehicle) {
      throw new NotFoundError('Vehicle');
    }

    // Check if user has edit permission
    const permission = await shareRepository.getPermission(id, user.id);
    if (permission !== 'edit') {
      throw new AuthorizationError('You do not have permission to edit this vehicle');
    }

    // Check if license plate already exists (if being updated)
    if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
      const vehicleWithPlate = await vehicleRepository.findByLicensePlate(updateData.licensePlate);
      if (vehicleWithPlate && vehicleWithPlate.id !== id) {
        throw new ConflictError('A vehicle with this license plate already exists');
      }
    }

    const updatedVehicle = await vehicleRepository.update(id, updateData);

    return c.json({
      success: true,
      data: updatedVehicle,
      message: 'Vehicle updated successfully',
    });
  }
);

// DELETE /api/vehicles/:id - Delete vehicle
vehicles.delete('/:id', zValidator('param', vehicleParamsSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const vehicleRepository = repositoryFactory.getVehicleRepository();

  // Check if vehicle exists and belongs to user
  const existingVehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
  if (!existingVehicle) {
    throw new NotFoundError('Vehicle');
  }

  await vehicleRepository.delete(id);

  return c.json({
    success: true,
    message: 'Vehicle deleted successfully',
  });
});

export { vehicles };
