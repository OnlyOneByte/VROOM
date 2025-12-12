/**
 * Repository Module - Direct Export Pattern
 *
 * ARCHITECTURAL DECISION: No Factory Pattern
 * ==========================================
 * This module uses direct singleton exports instead of a factory pattern.
 *
 * Why no factory?
 * - No dependency injection framework in use (no NestJS, InversifyJS, etc.)
 * - Simpler code with fewer abstractions
 * - Direct imports are easier to understand and trace
 * - Testing is still possible by exporting classes
 * - Reduces boilerplate without losing functionality
 *
 * Pattern:
 * ```typescript
 * // Production code - use singleton instances
 * import { userRepository } from './repositories';
 *
 * // Test code - instantiate with test database
 * import { UserRepository } from './repositories';
 * const testRepo = new UserRepository(testDb);
 * ```
 *
 * Previous approach (removed):
 * - Had factory.ts with createRepositories() function
 * - Had interfaces.ts with repository interfaces
 * - Added complexity without providing real DI benefits
 */

import { db } from '../../db/connection.js';
import { BackupRepository } from './backup.js';
import { BaseRepository } from './base.js';
import { ExpenseRepository } from './expense.js';
import { FinancingRepository } from './financing.js';
import { InsurancePolicyRepository } from './insurancePolicy.js';
import { SettingsRepository } from './settings.js';
import { UserRepository } from './user.js';
import { VehicleRepository } from './vehicle.js';

// Export repository instances (singleton pattern)
// These are the primary exports for production code
export const userRepository = new UserRepository(db);
export const vehicleRepository = new VehicleRepository(db);
export const expenseRepository = new ExpenseRepository(db);
export const financingRepository = new FinancingRepository(db);
export const insurancePolicyRepository = new InsurancePolicyRepository(db);
export const settingsRepository = new SettingsRepository(db);
export const backupRepository = new BackupRepository(db);

// Legacy exports for backward compatibility (deprecated)
export const vehicleFinancingRepository = financingRepository;
export const vehicleFinancingPaymentRepository = financingRepository;

// Export repository classes for testing purposes
// Tests can instantiate these with a test database instance
export {
  BaseRepository,
  UserRepository,
  VehicleRepository,
  ExpenseRepository,
  FinancingRepository,
  InsurancePolicyRepository,
  SettingsRepository,
  BackupRepository,
};

// Legacy exports for backward compatibility (deprecated)
export { FinancingRepository as VehicleFinancingRepository };
export { FinancingRepository as VehicleFinancingPaymentRepository };

// Export types
export type { ExpenseFilters } from './expense.js';
