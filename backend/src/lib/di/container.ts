import 'reflect-metadata';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Container } from 'inversify';
import { db } from '../../db/connection.js';
import { ExpenseRepository } from '../repositories/expense.js';
import { InsurancePolicyRepository } from '../repositories/insurancePolicy.js';
// Repository interfaces
import type {
  IExpenseRepository,
  IInsurancePolicyRepository,
  IUserRepository,
  IVehicleFinancingPaymentRepository,
  IVehicleFinancingRepository,
  IVehicleRepository,
  IVehicleShareRepository,
} from '../repositories/interfaces.js';
// Repositories
import { UserRepository } from '../repositories/user.js';
import { VehicleRepository } from '../repositories/vehicle.js';
import { VehicleFinancingRepository } from '../repositories/vehicleFinancing.js';
import { VehicleFinancingPaymentRepository } from '../repositories/vehicleFinancingPayment.js';
import { VehicleShareRepository } from '../repositories/vehicleShare.js';

// Services
import { AnalyticsService } from '../services/analytics/analytics-service.js';
import { TYPES } from './types.js';

// Create container
const container = new Container();

// Bind database
container.bind<BunSQLiteDatabase<Record<string, unknown>>>(TYPES.Database).toConstantValue(db);

// Bind repositories in singleton scope
container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();
container
  .bind<IVehicleRepository>(TYPES.VehicleRepository)
  .to(VehicleRepository)
  .inSingletonScope();
container
  .bind<IExpenseRepository>(TYPES.ExpenseRepository)
  .to(ExpenseRepository)
  .inSingletonScope();
container
  .bind<IInsurancePolicyRepository>(TYPES.InsurancePolicyRepository)
  .to(InsurancePolicyRepository)
  .inSingletonScope();
container
  .bind<IVehicleFinancingRepository>(TYPES.VehicleFinancingRepository)
  .to(VehicleFinancingRepository)
  .inSingletonScope();
container
  .bind<IVehicleFinancingPaymentRepository>(TYPES.VehicleFinancingPaymentRepository)
  .to(VehicleFinancingPaymentRepository)
  .inSingletonScope();
container
  .bind<IVehicleShareRepository>(TYPES.VehicleShareRepository)
  .to(VehicleShareRepository)
  .inSingletonScope();

// Bind services in transient scope (new instance per request)
container.bind<AnalyticsService>(TYPES.AnalyticsService).to(AnalyticsService);

// Helper function to rebind database for testing
export function rebindDatabase(testDb: BunSQLiteDatabase<Record<string, unknown>>) {
  // Unbind existing database binding
  if (container.isBound(TYPES.Database)) {
    container.unbind(TYPES.Database);
  }

  // Bind new database
  container
    .bind<BunSQLiteDatabase<Record<string, unknown>>>(TYPES.Database)
    .toConstantValue(testDb);

  // Unbind all singleton repositories so they get recreated with new database
  if (container.isBound(TYPES.UserRepository)) {
    container.unbind(TYPES.UserRepository);
  }
  if (container.isBound(TYPES.VehicleRepository)) {
    container.unbind(TYPES.VehicleRepository);
  }
  if (container.isBound(TYPES.ExpenseRepository)) {
    container.unbind(TYPES.ExpenseRepository);
  }
  if (container.isBound(TYPES.InsurancePolicyRepository)) {
    container.unbind(TYPES.InsurancePolicyRepository);
  }
  if (container.isBound(TYPES.VehicleFinancingRepository)) {
    container.unbind(TYPES.VehicleFinancingRepository);
  }
  if (container.isBound(TYPES.VehicleFinancingPaymentRepository)) {
    container.unbind(TYPES.VehicleFinancingPaymentRepository);
  }
  if (container.isBound(TYPES.VehicleShareRepository)) {
    container.unbind(TYPES.VehicleShareRepository);
  }

  // Rebind repositories with new database
  container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();
  container
    .bind<IVehicleRepository>(TYPES.VehicleRepository)
    .to(VehicleRepository)
    .inSingletonScope();
  container
    .bind<IExpenseRepository>(TYPES.ExpenseRepository)
    .to(ExpenseRepository)
    .inSingletonScope();
  container
    .bind<IInsurancePolicyRepository>(TYPES.InsurancePolicyRepository)
    .to(InsurancePolicyRepository)
    .inSingletonScope();
  container
    .bind<IVehicleFinancingRepository>(TYPES.VehicleFinancingRepository)
    .to(VehicleFinancingRepository)
    .inSingletonScope();
  container
    .bind<IVehicleFinancingPaymentRepository>(TYPES.VehicleFinancingPaymentRepository)
    .to(VehicleFinancingPaymentRepository)
    .inSingletonScope();
  container
    .bind<IVehicleShareRepository>(TYPES.VehicleShareRepository)
    .to(VehicleShareRepository)
    .inSingletonScope();
}

export { container };
