/**
 * Application Enums
 */

export enum ExpenseType {
  OPERATING = 'operating',
  MAINTENANCE = 'maintenance',
  FINANCIAL = 'financial',
  REGULATORY = 'regulatory',
  ENHANCEMENT = 'enhancement',
  CONVENIENCE = 'convenience',
}

export enum ExpenseCategory {
  // Operating expenses
  FUEL = 'fuel',
  PARKING = 'parking',
  TOLLS = 'tolls',

  // Maintenance expenses
  OIL_CHANGE = 'oil_change',
  TIRE_REPLACEMENT = 'tire_replacement',
  BRAKE_SERVICE = 'brake_service',
  ENGINE_REPAIR = 'engine_repair',
  TRANSMISSION_REPAIR = 'transmission_repair',
  GENERAL_MAINTENANCE = 'general_maintenance',

  // Financial expenses
  LOAN_PAYMENT = 'loan_payment',
  INSURANCE = 'insurance',
  DEPRECIATION = 'depreciation',

  // Regulatory expenses
  REGISTRATION = 'registration',
  INSPECTION = 'inspection',
  EMISSIONS_TEST = 'emissions_test',

  // Enhancement expenses
  PERFORMANCE_UPGRADE = 'performance_upgrade',
  AESTHETIC_MODIFICATION = 'aesthetic_modification',
  TECHNOLOGY_UPGRADE = 'technology_upgrade',

  // Convenience expenses
  CAR_WASH = 'car_wash',
  DETAILING = 'detailing',
  ACCESSORIES = 'accessories',
}

export enum PaymentFrequency {
  MONTHLY = 'monthly',
  BI_WEEKLY = 'bi-weekly',
  WEEKLY = 'weekly',
  CUSTOM = 'custom',
}

export enum PaymentType {
  STANDARD = 'standard',
  EXTRA = 'extra',
  CUSTOM_SPLIT = 'custom-split',
}

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
}

export enum AuthProvider {
  GOOGLE = 'google',
}

export enum Environment {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

/**
 * Type guards for enums
 */

export const isExpenseType = (value: string): value is ExpenseType => {
  return Object.values(ExpenseType).includes(value as ExpenseType);
};

export const isExpenseCategory = (value: string): value is ExpenseCategory => {
  return Object.values(ExpenseCategory).includes(value as ExpenseCategory);
};

export const isPaymentFrequency = (value: string): value is PaymentFrequency => {
  return Object.values(PaymentFrequency).includes(value as PaymentFrequency);
};

export const isCurrency = (value: string): value is Currency => {
  return Object.values(Currency).includes(value as Currency);
};

/**
 * Enum utilities
 */

export const getExpenseTypeLabel = (type: ExpenseType): string => {
  const labels: Record<ExpenseType, string> = {
    [ExpenseType.OPERATING]: 'Operating',
    [ExpenseType.MAINTENANCE]: 'Maintenance',
    [ExpenseType.FINANCIAL]: 'Financial',
    [ExpenseType.REGULATORY]: 'Regulatory',
    [ExpenseType.ENHANCEMENT]: 'Enhancement',
    [ExpenseType.CONVENIENCE]: 'Convenience',
  };
  return labels[type];
};

export const getExpenseCategoryLabel = (category: ExpenseCategory): string => {
  const labels: Record<ExpenseCategory, string> = {
    [ExpenseCategory.FUEL]: 'Fuel',
    [ExpenseCategory.PARKING]: 'Parking',
    [ExpenseCategory.TOLLS]: 'Tolls',
    [ExpenseCategory.OIL_CHANGE]: 'Oil Change',
    [ExpenseCategory.TIRE_REPLACEMENT]: 'Tire Replacement',
    [ExpenseCategory.BRAKE_SERVICE]: 'Brake Service',
    [ExpenseCategory.ENGINE_REPAIR]: 'Engine Repair',
    [ExpenseCategory.TRANSMISSION_REPAIR]: 'Transmission Repair',
    [ExpenseCategory.GENERAL_MAINTENANCE]: 'General Maintenance',
    [ExpenseCategory.LOAN_PAYMENT]: 'Loan Payment',
    [ExpenseCategory.INSURANCE]: 'Insurance',
    [ExpenseCategory.DEPRECIATION]: 'Depreciation',
    [ExpenseCategory.REGISTRATION]: 'Registration',
    [ExpenseCategory.INSPECTION]: 'Inspection',
    [ExpenseCategory.EMISSIONS_TEST]: 'Emissions Test',
    [ExpenseCategory.PERFORMANCE_UPGRADE]: 'Performance Upgrade',
    [ExpenseCategory.AESTHETIC_MODIFICATION]: 'Aesthetic Modification',
    [ExpenseCategory.TECHNOLOGY_UPGRADE]: 'Technology Upgrade',
    [ExpenseCategory.CAR_WASH]: 'Car Wash',
    [ExpenseCategory.DETAILING]: 'Detailing',
    [ExpenseCategory.ACCESSORIES]: 'Accessories',
  };
  return labels[category];
};
