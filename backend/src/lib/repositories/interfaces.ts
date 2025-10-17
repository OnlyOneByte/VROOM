import type {
  Expense,
  InsurancePolicy,
  NewExpense,
  NewInsurancePolicy,
  NewUser,
  NewVehicle,
  NewVehicleFinancing,
  NewVehicleFinancingPayment,
  NewVehicleShare,
  User,
  Vehicle,
  VehicleFinancing,
  VehicleFinancingPayment,
  VehicleShare,
} from '../../db/schema.js';

// Base repository interface with common CRUD operations
export interface IBaseRepository<T, TNew> {
  findById(id: string): Promise<T | null>;
  create(data: TNew): Promise<T>;
  update(id: string, data: Partial<TNew>): Promise<T>;
  delete(id: string): Promise<void>;
}

// User repository interface
export interface IUserRepository extends IBaseRepository<User, NewUser> {
  findByEmail(email: string): Promise<User | null>;
  findByProviderId(provider: string, providerId: string): Promise<User | null>;
  updateGoogleRefreshToken(id: string, token: string | null): Promise<User>;
}

// Vehicle repository interface
export interface IVehicleRepository extends IBaseRepository<Vehicle, NewVehicle> {
  findByUserId(userId: string): Promise<Vehicle[]>;
  findByUserIdAndId(userId: string, vehicleId: string): Promise<Vehicle | null>;
  findByLicensePlate(licensePlate: string): Promise<Vehicle | null>;
  updateMileage(id: string, mileage: number): Promise<Vehicle>;
  findAccessibleVehicles(userId: string): Promise<Vehicle[]>;
  findByIdWithAccess(vehicleId: string, userId: string): Promise<Vehicle | null>;
}

// Vehicle Financing repository interface
export interface IVehicleFinancingRepository
  extends IBaseRepository<VehicleFinancing, NewVehicleFinancing> {
  findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null>;
  findActiveFinancing(): Promise<VehicleFinancing[]>;
  updateBalance(id: string, newBalance: number): Promise<VehicleFinancing>;
  markAsCompleted(id: string, endDate: Date): Promise<VehicleFinancing>;
}

// Vehicle Financing Payment repository interface
export interface IVehicleFinancingPaymentRepository
  extends IBaseRepository<VehicleFinancingPayment, NewVehicleFinancingPayment> {
  findByFinancingId(financingId: string): Promise<VehicleFinancingPayment[]>;
  findByFinancingIdAndDateRange(
    financingId: string,
    startDate: Date,
    endDate: Date
  ): Promise<VehicleFinancingPayment[]>;
  getLastPayment(financingId: string): Promise<VehicleFinancingPayment | null>;
  getPaymentCount(financingId: string): Promise<number>;
}

// Insurance Policy repository interface
export interface IInsurancePolicyRepository
  extends IBaseRepository<InsurancePolicy, NewInsurancePolicy> {
  findByVehicleId(vehicleId: string): Promise<InsurancePolicy[]>;
  findActiveByVehicleId(vehicleId: string): Promise<InsurancePolicy | null>;
  findExpiringPolicies(userId: string, daysFromNow: number): Promise<InsurancePolicy[]>;
  markAsInactive(id: string): Promise<InsurancePolicy>;
}

// Expense repository interface
export interface IExpenseRepository extends IBaseRepository<Expense, NewExpense> {
  findByVehicleId(vehicleId: string): Promise<Expense[]>;
  findByVehicleIdAndDateRange(
    vehicleId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Expense[]>;
  findByUserId(userId: string): Promise<Expense[]>;
  findByCategory(vehicleId: string, category: string): Promise<Expense[]>;
  findFuelExpenses(vehicleId: string): Promise<Expense[]>;
  batchCreate(expenses: NewExpense[]): Promise<Expense[]>; // For offline sync
  getTotalByCategory(
    vehicleId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ category: string; total: number }[]>;
  getMonthlyTotals(vehicleId: string, year: number): Promise<{ month: number; total: number }[]>;
}

// Vehicle Share repository interface
export interface IVehicleShareRepository extends IBaseRepository<VehicleShare, NewVehicleShare> {
  findByVehicleId(vehicleId: string): Promise<VehicleShare[]>;
  findByOwnerId(ownerId: string): Promise<VehicleShare[]>;
  findBySharedWithUserId(userId: string): Promise<VehicleShare[]>;
  findByVehicleAndUser(vehicleId: string, userId: string): Promise<VehicleShare | null>;
  findPendingInvitations(userId: string): Promise<VehicleShare[]>;
  updateStatus(id: string, status: 'accepted' | 'declined'): Promise<VehicleShare>;
  hasAccess(vehicleId: string, userId: string): Promise<boolean>;
  getPermission(vehicleId: string, userId: string): Promise<'view' | 'edit' | null>;
}

// Repository factory interface for dependency injection
export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getVehicleRepository(): IVehicleRepository;
  getVehicleFinancingRepository(): IVehicleFinancingRepository;
  getVehicleFinancingPaymentRepository(): IVehicleFinancingPaymentRepository;
  getInsurancePolicyRepository(): IInsurancePolicyRepository;
  getExpenseRepository(): IExpenseRepository;
  getVehicleShareRepository(): IVehicleShareRepository;
}
