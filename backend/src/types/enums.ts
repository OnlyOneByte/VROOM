/**
 * Application Enums
 */

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

export const isPaymentFrequency = (value: string): value is PaymentFrequency => {
  return Object.values(PaymentFrequency).includes(value as PaymentFrequency);
};

export const isCurrency = (value: string): value is Currency => {
  return Object.values(Currency).includes(value as Currency);
};

/**
 * Enum utilities
 */
