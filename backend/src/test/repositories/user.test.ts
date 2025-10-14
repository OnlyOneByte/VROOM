import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { UserRepository } from '../../lib/repositories/user.js';
import { setupTestDatabase, teardownTestDatabase, testUserData } from '../setup.js';
import type { User } from '../../db/schema.js';

describe('UserRepository', () => {
  let userRepository: UserRepository;
  let testDb: ReturnType<typeof setupTestDatabase>;

  beforeEach(() => {
    testDb = setupTestDatabase();
    userRepository = new UserRepository();
  });

  afterEach(() => {
    teardownTestDatabase();
  });

  describe('create', () => {
    test('should create a new user', async () => {
      const user = await userRepository.create(testUserData);

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testUserData.email);
      expect(user.displayName).toBe(testUserData.displayName);
      expect(user.provider).toBe(testUserData.provider);
      expect(user.providerId).toBe(testUserData.providerId);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    test('should throw error for duplicate email', async () => {
      await userRepository.create(testUserData);
      
      expect(async () => {
        await userRepository.create(testUserData);
      }).toThrow();
    });
  });

  describe('findById', () => {
    test('should find user by id', async () => {
      const createdUser = await userRepository.create(testUserData);
      const foundUser = await userRepository.findById(createdUser.id);

      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(createdUser.id);
      expect(foundUser?.email).toBe(testUserData.email);
    });

    test('should return null for non-existent id', async () => {
      const foundUser = await userRepository.findById('non-existent-id');
      expect(foundUser).toBeNull();
    });
  });

  describe('findByEmail', () => {
    test('should find user by email', async () => {
      const createdUser = await userRepository.create(testUserData);
      const foundUser = await userRepository.findByEmail(testUserData.email);

      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(createdUser.id);
      expect(foundUser?.email).toBe(testUserData.email);
    });

    test('should return null for non-existent email', async () => {
      const foundUser = await userRepository.findByEmail('nonexistent@example.com');
      expect(foundUser).toBeNull();
    });
  });

  describe('findByProviderId', () => {
    test('should find user by provider and providerId', async () => {
      const createdUser = await userRepository.create(testUserData);
      const foundUser = await userRepository.findByProviderId(
        testUserData.provider,
        testUserData.providerId
      );

      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(createdUser.id);
      expect(foundUser?.provider).toBe(testUserData.provider);
      expect(foundUser?.providerId).toBe(testUserData.providerId);
    });

    test('should return null for non-existent provider/providerId', async () => {
      const foundUser = await userRepository.findByProviderId('google', 'non-existent');
      expect(foundUser).toBeNull();
    });
  });

  describe('update', () => {
    test('should update user fields', async () => {
      const createdUser = await userRepository.create(testUserData);
      const updateData = {
        displayName: 'Updated Name',
        googleRefreshToken: 'new-refresh-token',
      };

      const updatedUser = await userRepository.update(createdUser.id, updateData);

      expect(updatedUser.displayName).toBe(updateData.displayName);
      expect(updatedUser.googleRefreshToken).toBe(updateData.googleRefreshToken);
      expect(updatedUser.updatedAt.getTime()).toBeGreaterThan(createdUser.updatedAt.getTime());
    });

    test('should throw error for non-existent user', async () => {
      expect(async () => {
        await userRepository.update('non-existent-id', { displayName: 'New Name' });
      }).toThrow();
    });
  });

  describe('updateGoogleRefreshToken', () => {
    test('should update Google refresh token', async () => {
      const createdUser = await userRepository.create(testUserData);
      const newToken = 'new-refresh-token-123';

      const updatedUser = await userRepository.updateGoogleRefreshToken(createdUser.id, newToken);

      expect(updatedUser.googleRefreshToken).toBe(newToken);
      expect(updatedUser.updatedAt.getTime()).toBeGreaterThan(createdUser.updatedAt.getTime());
    });

    test('should set token to null', async () => {
      const createdUser = await userRepository.create({
        ...testUserData,
        googleRefreshToken: 'existing-token',
      });

      const updatedUser = await userRepository.updateGoogleRefreshToken(createdUser.id, null);

      expect(updatedUser.googleRefreshToken).toBeNull();
    });

    test('should throw error for non-existent user', async () => {
      expect(async () => {
        await userRepository.updateGoogleRefreshToken('non-existent-id', 'token');
      }).toThrow();
    });
  });

  describe('delete', () => {
    test('should delete user', async () => {
      const createdUser = await userRepository.create(testUserData);
      
      await userRepository.delete(createdUser.id);
      
      const foundUser = await userRepository.findById(createdUser.id);
      expect(foundUser).toBeNull();
    });

    test('should throw error for non-existent user', async () => {
      expect(async () => {
        await userRepository.delete('non-existent-id');
      }).toThrow();
    });
  });
});