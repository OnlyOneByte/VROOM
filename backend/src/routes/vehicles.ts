import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';
import type { NewVehicle } from '../db/schema';

const vehicles = new Hono();

// Validation schemas
const createVehicleSchema = z.object({
  make: z.string().min(1, 'Make is required').max(50, 'Make must be 50 characters or less'),
  model: z.string().min(1, 'Model is required').max(50, 'Model must be 50 characters or less'),
  year: z.number().int().min(1900, 'Year must be 1900 or later').max(new Date().getFullYear() + 1, 'Year cannot be in the future'),
  licensePlate: z.string().max(20, 'License plate must be 20 characters or less').optional(),
  nickname: z.string().max(50, 'Nickname must be 50 characters or less').optional(),
  initialMileage: z.number().int().min(0, 'Initial mileage cannot be negative').optional(),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative').optional(),
  purchaseDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
});

const updateVehicleSchema = createVehicleSchema.partial();

const vehicleParamsSchema = z.object({
  id: z.string().min(1, 'Vehicle ID is required'),
});

// Apply authentication to all routes
vehicles.use('*', requireAuth);

// GET /api/vehicles - List user's vehicles
vehicles.get('/', async (c) => {
  try {
    const user = c.get('user');
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    
    const userVehicles = await vehicleRepository.findByUserId(user.id);
    
    return c.json({
      success: true,
      data: userVehicles,
      count: userVehicles.length,
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    throw new HTTPException(500, { message: 'Failed to fetch vehicles' });
  }
});

// POST /api/vehicles - Create new vehicle
vehicles.post('/', zValidator('json', createVehicleSchema), async (c) => {
  try {
    const user = c.get('user');
    const vehicleData = c.req.valid('json');
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    
    // Check if license plate already exists (if provided)
    if (vehicleData.licensePlate) {
      const existingVehicle = await vehicleRepository.findByLicensePlate(vehicleData.licensePlate);
      if (existingVehicle) {
        throw new HTTPException(409, { 
          message: 'A vehicle with this license plate already exists' 
        });
      }
    }
    
    const newVehicle: NewVehicle = {
      ...vehicleData,
      userId: user.id,
    };
    
    const createdVehicle = await vehicleRepository.create(newVehicle);
    
    return c.json({
      success: true,
      data: createdVehicle,
      message: 'Vehicle created successfully',
    }, 201);
  } catch (error) {
    console.error('Error creating vehicle:', error);
    
    if (error instanceof HTTPException) {
      throw error;
    }
    
    throw new HTTPException(500, { message: 'Failed to create vehicle' });
  }
});

// GET /api/vehicles/:id - Get specific vehicle
vehicles.get('/:id', zValidator('param', vehicleParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
    
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }
    
    return c.json({
      success: true,
      data: vehicle,
    });
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    
    if (error instanceof HTTPException) {
      throw error;
    }
    
    throw new HTTPException(500, { message: 'Failed to fetch vehicle' });
  }
});

// PUT /api/vehicles/:id - Update vehicle
vehicles.put('/:id', 
  zValidator('param', vehicleParamsSchema),
  zValidator('json', updateVehicleSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const updateData = c.req.valid('json');
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      
      // Check if vehicle exists and belongs to user
      const existingVehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
      if (!existingVehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      // Check if license plate already exists (if being updated)
      if (updateData.licensePlate && updateData.licensePlate !== existingVehicle.licensePlate) {
        const vehicleWithPlate = await vehicleRepository.findByLicensePlate(updateData.licensePlate);
        if (vehicleWithPlate && vehicleWithPlate.id !== id) {
          throw new HTTPException(409, { 
            message: 'A vehicle with this license plate already exists' 
          });
        }
      }
      
      const updatedVehicle = await vehicleRepository.update(id, updateData);
      
      return c.json({
        success: true,
        data: updatedVehicle,
        message: 'Vehicle updated successfully',
      });
    } catch (error) {
      console.error('Error updating vehicle:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to update vehicle' });
    }
  }
);

// DELETE /api/vehicles/:id - Delete vehicle
vehicles.delete('/:id', zValidator('param', vehicleParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const vehicleRepository = repositoryFactory.getVehicleRepository();
    
    // Check if vehicle exists and belongs to user
    const existingVehicle = await vehicleRepository.findByUserIdAndId(user.id, id);
    if (!existingVehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }
    
    await vehicleRepository.delete(id);
    
    return c.json({
      success: true,
      message: 'Vehicle deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    
    if (error instanceof HTTPException) {
      throw error;
    }
    
    throw new HTTPException(500, { message: 'Failed to delete vehicle' });
  }
});

export { vehicles };