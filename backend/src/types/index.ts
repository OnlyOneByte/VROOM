// Core data model interfaces for VROOM Car Tracker
// Based on design document specifications

export interface User {
  id: string;
  email: string;
  displayName: string;
  provider: 'google';
  providerId: string;
  googleRefreshToken?: string; // For Google Sheets access
  createdAt: Date;
  updatedAt: Date;
}

export interface Vehicle {
  id: string;
  userId: string;
  make: string;
  model: string;
  year: number;
  licensePlate?: string;
  nickname?: string;
  initialMileage?: number;
  // Purchase Information
  purchasePrice?: number;
  purchaseDate?: Date;
  // Loan Information (containerized)
  loan?: VehicleLoan;
  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleLoan {
  id: string;
  vehicleId: string;
  // Basic Loan Terms
  lender: string;
  originalAmount: number;
  currentBalance: number;
  apr: number;
  termMonths: number;
  startDate: Date;
  // Payment Configuration
  standardPayment: LoanPaymentConfig;
  customPaymentSchedule?: LoanPaymentConfig[]; // For future split payments
  // Loan Status
  isActive: boolean;
  payoffDate?: Date; // Actual payoff date if paid early
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanPaymentConfig {
  amount: number;
  frequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
  dayOfMonth?: number; // For monthly (1-31)
  dayOfWeek?: number;  // For weekly (0-6, Sunday=0)
  customSchedule?: {
    amount: number;
    dayOfMonth: number;
  }[]; // For future: multiple payments per month
}

export type ExpenseType = 
  // Operating Costs
  | 'fuel' | 'tolls' | 'parking'
  // Maintenance & Repairs
  | 'maintenance' | 'repairs' | 'tires' | 'oil-change'
  // Financial
  | 'insurance' | 'loan-payment'
  // Regulatory/Legal
  | 'registration' | 'inspection' | 'emissions' | 'tickets'
  // Enhancements/Modifications
  | 'modifications' | 'accessories' | 'detailing'
  // Other
  | 'other';

export type ExpenseCategory = 
  | 'operating'     // Day-to-day driving costs (fuel, tolls, parking)
  | 'maintenance'   // Keeping the car running (oil, repairs, tires)
  | 'financial'    // Loans, insurance
  | 'regulatory'   // Government-required (registration, inspection, tickets)
  | 'enhancement'  // Optional improvements (tint, accessories, detailing)
  | 'convenience'; // Nice-to-have (vanity plates, car washes)

export interface Expense {
  id: string;
  vehicleId: string;
  type: ExpenseType;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  date: Date;
  mileage?: number;
  gallons?: number; // For fuel expenses
  description?: string;
  receiptUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsurancePolicy {
  id: string;
  vehicleId: string;
  company: string;
  policyNumber?: string;
  totalCost: number;
  termLengthMonths: number; // e.g., 6 for 6-month terms
  startDate: Date;
  endDate: Date;
  monthlyCost: number; // Calculated: totalCost / termLengthMonths
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanPayment {
  id: string;
  loanId: string; // References VehicleLoan.id
  paymentDate: Date;
  paymentAmount: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
  paymentNumber: number;
  paymentType: 'standard' | 'extra' | 'custom-split';
  isScheduled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoanAnalysis {
  loanId: string;
  currentScenario: LoanScenario;
  alternativeScenarios: LoanScenario[];
}

export interface LoanScenario {
  name: string; // "Current", "Pay Extra $100/month", "Bi-weekly payments"
  paymentConfig: LoanPaymentConfig;
  projectedPayoffDate: Date;
  totalInterestPaid: number;
  interestSavings: number; // Compared to standard
  monthsSaved: number;
  schedule: LoanPayment[];
}

export interface FuelEfficiency {
  vehicleId: string;
  date: Date;
  mpg: number;
  milesPerMonth: number;
  costPerMile: number;
  totalGallons: number;
}

export interface StorageConfig {
  sqlite: {
    path: string;
    backupEnabled: boolean;
  };
  googleDrive: {
    enabled: boolean;
    folderId?: string; // VROOM folder ID in Google Drive
    spreadsheetId?: string; // Main data spreadsheet ID
    autoSync: boolean;
    syncInterval: 'manual' | 'daily' | 'weekly' | 'on-inactivity';
    inactivityDelay: number; // Minutes of inactivity before auto-sync (default: 5)
    organizeByDate: boolean; // Auto-organize receipts by date
  };
  // Future: extensible for additional providers
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Authentication types
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}