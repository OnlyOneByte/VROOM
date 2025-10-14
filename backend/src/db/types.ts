// Expense type definitions based on design document

export type ExpenseType = 
  // Operating Costs
  | 'fuel' 
  | 'tolls' 
  | 'parking'
  // Maintenance & Repairs
  | 'maintenance' 
  | 'repairs' 
  | 'tires' 
  | 'oil-change'
  // Financial
  | 'insurance' 
  | 'loan-payment'
  // Regulatory/Legal
  | 'registration' 
  | 'inspection' 
  | 'emissions' 
  | 'tickets'
  // Enhancements/Modifications
  | 'modifications' 
  | 'accessories' 
  | 'detailing'
  // Other
  | 'other';

export type ExpenseCategory = 
  | 'operating'     // Day-to-day driving costs (fuel, tolls, parking)
  | 'maintenance'   // Keeping the car running (oil, repairs, tires)
  | 'financial'    // Loans, insurance
  | 'regulatory'   // Government-required (registration, inspection, tickets)
  | 'enhancement'  // Optional improvements (tint, accessories, detailing)
  | 'convenience'; // Nice-to-have (vanity plates, car washes)

export type PaymentFrequency = 
  | 'monthly' 
  | 'bi-weekly' 
  | 'weekly' 
  | 'custom';

export type PaymentType = 
  | 'standard' 
  | 'extra' 
  | 'custom-split';

export type AuthProvider = 'google';

// Utility function to get category for expense type
export function getCategoryForExpenseType(type: ExpenseType): ExpenseCategory {
  const categoryMap: Record<ExpenseType, ExpenseCategory> = {
    // Operating
    'fuel': 'operating',
    'tolls': 'operating',
    'parking': 'operating',
    
    // Maintenance
    'maintenance': 'maintenance',
    'repairs': 'maintenance',
    'tires': 'maintenance',
    'oil-change': 'maintenance',
    
    // Financial
    'insurance': 'financial',
    'loan-payment': 'financial',
    
    // Regulatory
    'registration': 'regulatory',
    'inspection': 'regulatory',
    'emissions': 'regulatory',
    'tickets': 'regulatory',
    
    // Enhancement
    'modifications': 'enhancement',
    'accessories': 'enhancement',
    'detailing': 'enhancement',
    
    // Other
    'other': 'convenience'
  };
  
  return categoryMap[type];
}

// Validation functions
export function isValidExpenseType(type: string): type is ExpenseType {
  const validTypes: ExpenseType[] = [
    'fuel', 'tolls', 'parking',
    'maintenance', 'repairs', 'tires', 'oil-change',
    'insurance', 'loan-payment',
    'registration', 'inspection', 'emissions', 'tickets',
    'modifications', 'accessories', 'detailing',
    'other'
  ];
  return validTypes.includes(type as ExpenseType);
}

export function isValidExpenseCategory(category: string): category is ExpenseCategory {
  const validCategories: ExpenseCategory[] = [
    'operating', 'maintenance', 'financial', 'regulatory', 'enhancement', 'convenience'
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