/**
 * Application Enums
 */

export enum ExpenseCategory {
  FUEL = 'fuel',
  MAINTENANCE = 'maintenance',
  FINANCIAL = 'financial',
  REGULATORY = 'regulatory',
  ENHANCEMENT = 'enhancement',
  MISC = 'misc',
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

export const getExpenseCategoryLabel = (category: ExpenseCategory): string => {
  const labels: Record<ExpenseCategory, string> = {
    [ExpenseCategory.FUEL]: 'Fuel',
    [ExpenseCategory.MAINTENANCE]: 'Maintenance',
    [ExpenseCategory.FINANCIAL]: 'Financial',
    [ExpenseCategory.REGULATORY]: 'Regulatory',
    [ExpenseCategory.ENHANCEMENT]: 'Enhancement',
    [ExpenseCategory.MISC]: 'Misc Operating Costs',
  };
  return labels[category];
};
