// Dependency injection type identifiers
export const TYPES = {
  // Database
  Database: Symbol.for('Database'),

  // Repositories
  UserRepository: Symbol.for('UserRepository'),
  VehicleRepository: Symbol.for('VehicleRepository'),
  ExpenseRepository: Symbol.for('ExpenseRepository'),
  InsurancePolicyRepository: Symbol.for('InsurancePolicyRepository'),
  VehicleFinancingRepository: Symbol.for('VehicleFinancingRepository'),
  VehicleFinancingPaymentRepository: Symbol.for('VehicleFinancingPaymentRepository'),
  VehicleShareRepository: Symbol.for('VehicleShareRepository'),

  // Services
  AnalyticsService: Symbol.for('AnalyticsService'),
} as const;
