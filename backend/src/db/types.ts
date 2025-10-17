// Expense Categories - Single source of truth
export const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  financial: 'Financial',
  regulatory: 'Regulatory',
  enhancement: 'Enhancement',
  misc: 'Misc Operating Costs',
};

export const EXPENSE_CATEGORY_DESCRIPTIONS: Record<ExpenseCategory, string> = {
  fuel: 'Fuel and gas costs',
  maintenance: 'Keeping the car running (oil, repairs, tires)',
  financial: 'Loans, insurance',
  regulatory: 'Government-required (registration, inspection, tickets)',
  enhancement: 'Optional improvements (tint, accessories, detailing)',
  misc: 'Misc operating costs (tolls, parking, car washes, etc.)',
};

export type PaymentFrequency = 'monthly' | 'bi-weekly' | 'weekly' | 'custom';

export type PaymentType = 'standard' | 'extra' | 'custom-split';

export type AuthProvider = 'google';

export type SharePermission = 'view' | 'edit';

export type ShareStatus = 'pending' | 'accepted' | 'declined';

// Validation functions
export function isValidExpenseCategory(category: string): category is ExpenseCategory {
  return EXPENSE_CATEGORIES.includes(category as ExpenseCategory);
}

export function isValidPaymentFrequency(frequency: string): frequency is PaymentFrequency {
  const validFrequencies: PaymentFrequency[] = ['monthly', 'bi-weekly', 'weekly', 'custom'];
  return validFrequencies.includes(frequency as PaymentFrequency);
}

export function isValidPaymentType(type: string): type is PaymentType {
  const validTypes: PaymentType[] = ['standard', 'extra', 'custom-split'];
  return validTypes.includes(type as PaymentType);
}

export function isValidSharePermission(permission: string): permission is SharePermission {
  const validPermissions: SharePermission[] = ['view', 'edit'];
  return validPermissions.includes(permission as SharePermission);
}

export function isValidShareStatus(status: string): status is ShareStatus {
  const validStatuses: ShareStatus[] = ['pending', 'accepted', 'declined'];
  return validStatuses.includes(status as ShareStatus);
}
