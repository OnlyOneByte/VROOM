import { ExpenseRepository } from './expense.js';
import { InsurancePolicyRepository } from './insurancePolicy.js';
import type { IRepositoryFactory } from './interfaces.js';
import { LoanPaymentRepository } from './loanPayment.js';
import { UserRepository } from './user.js';
import { VehicleRepository } from './vehicle.js';
import { VehicleLoanRepository } from './vehicleLoan.js';

// SQLite repository factory implementation
export class SQLiteRepositoryFactory implements IRepositoryFactory {
  private userRepository?: UserRepository;
  private vehicleRepository?: VehicleRepository;
  private vehicleLoanRepository?: VehicleLoanRepository;
  private loanPaymentRepository?: LoanPaymentRepository;
  private insurancePolicyRepository?: InsurancePolicyRepository;
  private expenseRepository?: ExpenseRepository;

  getUserRepository(): UserRepository {
    if (!this.userRepository) {
      this.userRepository = new UserRepository();
    }
    return this.userRepository;
  }

  getVehicleRepository(): VehicleRepository {
    if (!this.vehicleRepository) {
      this.vehicleRepository = new VehicleRepository();
    }
    return this.vehicleRepository;
  }

  getVehicleLoanRepository(): VehicleLoanRepository {
    if (!this.vehicleLoanRepository) {
      this.vehicleLoanRepository = new VehicleLoanRepository();
    }
    return this.vehicleLoanRepository;
  }

  getLoanPaymentRepository(): LoanPaymentRepository {
    if (!this.loanPaymentRepository) {
      this.loanPaymentRepository = new LoanPaymentRepository();
    }
    return this.loanPaymentRepository;
  }

  getInsurancePolicyRepository(): InsurancePolicyRepository {
    if (!this.insurancePolicyRepository) {
      this.insurancePolicyRepository = new InsurancePolicyRepository();
    }
    return this.insurancePolicyRepository;
  }

  getExpenseRepository(): ExpenseRepository {
    if (!this.expenseRepository) {
      this.expenseRepository = new ExpenseRepository();
    }
    return this.expenseRepository;
  }
}

// Global repository factory instance
export const repositoryFactory = new SQLiteRepositoryFactory();
