import { container } from '../di/container.js';
import { TYPES } from '../di/types.js';
import type { ExpenseRepository } from './expense.js';
import type { InsurancePolicyRepository } from './insurancePolicy.js';
import type { IRepositoryFactory } from './interfaces.js';
import type { UserRepository } from './user.js';
import type { VehicleRepository } from './vehicle.js';
import type { VehicleFinancingRepository } from './vehicleFinancing.js';
import type { VehicleFinancingPaymentRepository } from './vehicleFinancingPayment.js';
import type { VehicleShareRepository } from './vehicleShare.js';

// SQLite repository factory implementation using DI container
export class SQLiteRepositoryFactory implements IRepositoryFactory {
  getUserRepository(): UserRepository {
    return container.get<UserRepository>(TYPES.UserRepository);
  }

  getVehicleRepository(): VehicleRepository {
    return container.get<VehicleRepository>(TYPES.VehicleRepository);
  }

  getVehicleFinancingRepository(): VehicleFinancingRepository {
    return container.get<VehicleFinancingRepository>(TYPES.VehicleFinancingRepository);
  }

  getVehicleFinancingPaymentRepository(): VehicleFinancingPaymentRepository {
    return container.get<VehicleFinancingPaymentRepository>(
      TYPES.VehicleFinancingPaymentRepository
    );
  }

  getInsurancePolicyRepository(): InsurancePolicyRepository {
    return container.get<InsurancePolicyRepository>(TYPES.InsurancePolicyRepository);
  }

  getExpenseRepository(): ExpenseRepository {
    return container.get<ExpenseRepository>(TYPES.ExpenseRepository);
  }

  getVehicleShareRepository(): VehicleShareRepository {
    return container.get<VehicleShareRepository>(TYPES.VehicleShareRepository);
  }
}

// Global repository factory instance (backward compatibility)
export const repositoryFactory = new SQLiteRepositoryFactory();
