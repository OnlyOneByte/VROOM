// Repository interfaces for data access abstraction
import type { User, Vehicle, Expense, VehicleLoan, InsurancePolicy, LoanPayment } from '@/types';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByProviderId(provider: string, providerId: string): Promise<User | null>;
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, user: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
}

export interface IVehicleRepository {
  findByUserId(userId: string): Promise<Vehicle[]>;
  findById(id: string): Promise<Vehicle | null>;
  create(vehicle: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle>;
  update(id: string, vehicle: Partial<Vehicle>): Promise<Vehicle>;
  delete(id: string): Promise<void>;
}

export interface IExpenseRepository {
  findByVehicleId(vehicleId: string): Promise<Expense[]>;
  findById(id: string): Promise<Expense | null>;
  findByDateRange(vehicleId: string, startDate: Date, endDate: Date): Promise<Expense[]>;
  create(expense: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>): Promise<Expense>;
  update(id: string, expense: Partial<Expense>): Promise<Expense>;
  delete(id: string): Promise<void>;
  batchCreate(expenses: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<Expense[]>;
}

export interface ILoanRepository {
  findByVehicleId(vehicleId: string): Promise<VehicleLoan | null>;
  findById(id: string): Promise<VehicleLoan | null>;
  create(loan: Omit<VehicleLoan, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleLoan>;
  update(id: string, loan: Partial<VehicleLoan>): Promise<VehicleLoan>;
  delete(id: string): Promise<void>;
}

export interface ILoanPaymentRepository {
  findByLoanId(loanId: string): Promise<LoanPayment[]>;
  findById(id: string): Promise<LoanPayment | null>;
  create(payment: Omit<LoanPayment, 'id' | 'createdAt' | 'updatedAt'>): Promise<LoanPayment>;
  update(id: string, payment: Partial<LoanPayment>): Promise<LoanPayment>;
  delete(id: string): Promise<void>;
}

export interface IInsuranceRepository {
  findByVehicleId(vehicleId: string): Promise<InsurancePolicy[]>;
  findById(id: string): Promise<InsurancePolicy | null>;
  create(policy: Omit<InsurancePolicy, 'id' | 'createdAt' | 'updatedAt'>): Promise<InsurancePolicy>;
  update(id: string, policy: Partial<InsurancePolicy>): Promise<InsurancePolicy>;
  delete(id: string): Promise<void>;
}