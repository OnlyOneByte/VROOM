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

export enum DistanceUnit {
  MILES = 'miles',
  KILOMETERS = 'kilometers',
}

export enum VolumeUnit {
  GALLONS_US = 'gallons_us',
  GALLONS_UK = 'gallons_uk',
  LITERS = 'liters',
}

export enum ChargeUnit {
  KWH = 'kwh',
}

export enum VehicleType {
  GAS = 'gas',
  ELECTRIC = 'electric',
  HYBRID = 'hybrid',
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

export const isDistanceUnit = (value: string): value is DistanceUnit => {
  return Object.values(DistanceUnit).includes(value as DistanceUnit);
};

export const isVolumeUnit = (value: string): value is VolumeUnit => {
  return Object.values(VolumeUnit).includes(value as VolumeUnit);
};

export const isChargeUnit = (value: string): value is ChargeUnit => {
  return Object.values(ChargeUnit).includes(value as ChargeUnit);
};

export const isVehicleType = (value: string): value is VehicleType => {
  return Object.values(VehicleType).includes(value as VehicleType);
};

/**
 * Enum utilities
 */
