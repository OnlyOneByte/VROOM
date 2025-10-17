export type ExpenseCategory =
  | 'fuel'
  | 'maintenance'
  | 'financial'
  | 'regulatory'
  | 'enhancement'
  | 'misc';

export type PaymentFrequency = 'monthly' | 'bi-weekly' | 'weekly' | 'custom';

export type PaymentType = 'standard' | 'extra' | 'custom-split';

export type AuthProvider = 'google';

export type SharePermission = 'view' | 'edit';

export type ShareStatus = 'pending' | 'accepted' | 'declined';

// Validation functions
export function isValidExpenseCategory(category: string): category is ExpenseCategory {
  const validCategories: ExpenseCategory[] = [
    'fuel',
    'maintenance',
    'financial',
    'regulatory',
    'enhancement',
    'misc',
  ];
  return validCategories.includes(category as ExpenseCategory);
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
