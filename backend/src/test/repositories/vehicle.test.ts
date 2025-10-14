import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { VehicleRepository } from '../../lib/repositories/vehicle.js';
import { UserRepository } from '../../lib/repositories/user.js';
import { setupTestDatabase, teardownTestDatabase, testUserData, testVehicleData } from '../setup.js';
import type { User, Vehicle } from '../../db/schema.js';

describe('VehicleRepository', () => {
  let vehicleRepository: VehicleRepository;
  let userRepository: UserRepository;
  let testDb: ReturnType<typeof setupTestDatabase>;
  let testUser: User;

  beforeEach(async () => {
    testDb = setupTestDatabase();
    vehicleRepository = new VehicleRepository();
    userRepository = new UserRepository();
    
    // Create a test user for vehicle operations
    testUser = await userRepository.create(testUserData);
  });

  afterEach(() => {
    teardownTestDatabase();
  });

  describe('create', () => {
    test('should create a new vehicle', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const vehicle = await vehicleRepository.create(vehicleData);

      expect(vehicle).toBeDefined();
      expect(vehicle.id).toBeDefined();
      expect(vehicle.userId).toBe(testUser.id);
      expect(vehicle.make).toBe(testVehicleData.make);
      expect(vehicle.model).toBe(testVehicleData.model);
      expect(vehicle.year).toBe(testVehicleData.year);
      expect(vehicle.licensePlate).toBe(testVehicleData.licensePlate);
      expect(vehicle.createdAt).toBeInstanceOf(Date);
      expect(vehicle.updatedAt).toBeInstanceOf(Date);
    });

    test('should create vehicle with minimal required fields', async () => {
      const minimalVehicleData = {
        userId: testUser.id,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
      };

      const vehicle = await vehicleRepository.create(minimalVehicleData);

      expect(vehicle).toBeDefined();
      expect(vehicle.make).toBe(minimalVehicleData.make);
      expect(vehicle.model).toBe(minimalVehicleData.model);
      expect(vehicle.year).toBe(minimalVehicleData.year);
      expect(vehicle.licensePlate).toBeNull();
      expect(vehicle.nickname).toBeNull();
    });
  });

  describe('findById', () => {
    test('should find vehicle by id', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      const foundVehicle = await vehicleRepository.findById(createdVehicle.id);

      expect(foundVehicle).toBeDefined();
      expect(foundVehicle?.id).toBe(createdVehicle.id);
      expect(foundVehicle?.make).toBe(testVehicleData.make);
    });

    test('should return null for non-existent id', async () => {
      const foundVehicle = await vehicleRepository.findById('non-existent-id');
      expect(foundVehicle).toBeNull();
    });
  });

  describe('findByUserId', () => {
    test('should find all vehicles for a user', async () => {
      const vehicle1Data = { ...testVehicleData, userId: testUser.id };
      const vehicle2Data = { 
        ...testVehicleData, 
        userId: testUser.id, 
        make: 'Honda',
        model: 'Civic',
        licensePlate: 'TEST456'
      };

      await vehicleRepository.create(vehicle1Data);
      await vehicleRepository.create(vehicle2Data);

      const userVehicles = await vehicleRepository.findByUserId(testUser.id);

      expect(userVehicles).toHaveLength(2);
      expect(userVehicles[0].userId).toBe(testUser.id);
      expect(userVehicles[1].userId).toBe(testUser.id);
    });

    test('should return empty array for user with no vehicles', async () => {
      const userVehicles = await vehicleRepository.findByUserId(testUser.id);
      expect(userVehicles).toHaveLength(0);
    });
  });

  describe('findByUserIdAndId', () => {
    test('should find vehicle by user id and vehicle id', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      
      const foundVehicle = await vehicleRepository.findByUserIdAndId(
        testUser.id, 
        createdVehicle.id
      );

      expect(foundVehicle).toBeDefined();
      expect(foundVehicle?.id).toBe(createdVehicle.id);
      expect(foundVehicle?.userId).toBe(testUser.id);
    });

    test('should return null for wrong user id', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      
      const foundVehicle = await vehicleRepository.findByUserIdAndId(
        'wrong-user-id', 
        createdVehicle.id
      );

      expect(foundVehicle).toBeNull();
    });
  });

  describe('findByLicensePlate', () => {
    test('should find vehicle by license plate', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      
      const foundVehicle = await vehicleRepository.findByLicensePlate(testVehicleData.licensePlate!);

      expect(foundVehicle).toBeDefined();
      expect(foundVehicle?.id).toBe(createdVehicle.id);
      expect(foundVehicle?.licensePlate).toBe(testVehicleData.licensePlate);
    });

    test('should return null for non-existent license plate', async () => {
      const foundVehicle = await vehicleRepository.findByLicensePlate('NONEXISTENT');
      expect(foundVehicle).toBeNull();
    });
  });

  describe('update', () => {
    test('should update vehicle fields', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      
      const updateData = {
        nickname: 'Updated Nickname',
        initialMileage: 30000,
      };

      const updatedVehicle = await vehicleRepository.update(createdVehicle.id, updateData);

      expect(updatedVehicle.nickname).toBe(updateData.nickname);
      expect(updatedVehicle.initialMileage).toBe(updateData.initialMileage);
      expect(updatedVehicle.updatedAt.getTime()).toBeGreaterThan(createdVehicle.updatedAt.getTime());
    });

    test('should throw error for non-existent vehicle', async () => {
      expect(async () => {
        await vehicleRepository.update('non-existent-id', { nickname: 'New Name' });
      }).toThrow();
    });
  });

  describe('updateMileage', () => {
    test('should update vehicle mileage', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      const newMileage = 35000;

      const updatedVehicle = await vehicleRepository.updateMileage(createdVehicle.id, newMileage);

      expect(updatedVehicle.initialMileage).toBe(newMileage);
      expect(updatedVehicle.updatedAt.getTime()).toBeGreaterThan(createdVehicle.updatedAt.getTime());
    });

    test('should throw error for non-existent vehicle', async () => {
      expect(async () => {
        await vehicleRepository.updateMileage('non-existent-id', 35000);
      }).toThrow();
    });
  });

  describe('delete', () => {
    test('should delete vehicle', async () => {
      const vehicleData = { ...testVehicleData, userId: testUser.id };
      const createdVehicle = await vehicleRepository.create(vehicleData);
      
      await vehicleRepository.delete(createdVehicle.id);
      
      const foundVehicle = await vehicleRepository.findById(createdVehicle.id);
      expect(foundVehicle).toBeNull();
    });

    test('should throw error for non-existent vehicle', async () => {
      expect(async () => {
        await vehicleRepository.delete('non-existent-id');
      }).toThrow();
    });
  });
});