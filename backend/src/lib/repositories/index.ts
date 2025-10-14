// Repository interfaces
export type {
  IBaseRepository,
  IUserRepository,
  IVehicleRepository,
  IVehicleLoanRepository,
  ILoanPaymentRepository,
  IInsurancePolicyRepository,
  IExpenseRepository,
  IRepositoryFactory,
} from './interfaces.js';

// Repository implementations
export { BaseRepository } from './base.js';
export { UserRepository } from './user.js';
export { VehicleRepository } from './vehicle.js';
export { VehicleLoanRepository } from './vehicleLoan.js';
export { LoanPaymentRepository } from './loanPayment.js';
export { InsurancePolicyRepository } from './insurancePolicy.js';
export { ExpenseRepository } from './expense.js';

// Repository factory
export { SQLiteRepositoryFactory, repositoryFactory } from './factory.js';