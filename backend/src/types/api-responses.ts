// API Response Types for Testing

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  count?: number;
}

export interface VehicleResponse {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate?: string;
  nickname?: string;
  initialMileage?: number;
  purchasePrice?: number;
  purchaseDate?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsurancePolicyResponse {
  id: string;
  company: string;
  policyNumber: string;
  totalCost: number;
  termLengthMonths: number;
  startDate: string;
  endDate: string;
  monthlyCost: number;
  vehicleId: string;
  isActive: boolean;
  daysUntilExpiration?: number;
  expirationAlert?: {
    type: string;
    severity: string;
    message: string;
  };
}

export interface VehicleLoanResponse {
  id: string;
  vehicleId: string;
  financingType: string;
  provider: string;
  originalAmount: number;
  currentBalance: number;
  apr?: number;
  termMonths: number;
  startDate: string;
  paymentAmount: number;
  paymentFrequency: string;
  paymentDayOfMonth?: number;
  paymentDayOfWeek?: number;
  residualValue?: number;
  mileageLimit?: number;
  excessMileageFee?: number;
  isActive: boolean;
  endDate?: string;
}

export interface LoanPaymentResponse {
  id: string;
  financingId: string;
  paymentAmount: number;
  paymentNumber: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
  paymentDate: string;
}

export interface LoanAnalysisResponse {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
}

export interface LoanScheduleResponse {
  analysis: LoanAnalysisResponse;
  schedule: Array<{
    paymentNumber: number;
    paymentDate: string;
    paymentAmount: number;
    principalAmount: number;
    interestAmount: number;
    remainingBalance: number;
  }>;
}

export interface CostBreakdownResponse {
  policyId: string;
  company: string;
  totalCost: number;
  monthlyCost: number;
  breakdown: Array<{
    month: number;
    monthName: string;
    cost: number;
  }>;
}

export type ExpenseListApiResponse = Array<{
  id: string;
  tags: string[];
  category: string;
  amount: number;
  vehicleId: string;
  description?: string;
  date: string;
  mileage?: number;
  gallons?: number;
}>;

export interface ExpenseListApiResponseWithMeta extends ApiResponse<ExpenseListApiResponse> {
  count: number;
  filters: {
    tags?: string[];
    category?: string;
    startDate?: string;
    endDate?: string;
  };
}

export interface ExpenseCategoryInfo {
  value: string;
  label: string;
  description: string;
}

export type ExpenseCategoriesApiResponse = ExpenseCategoryInfo[];

export interface FuelEfficiencyApiResponse {
  vehicleId: string;
  totalFuelExpenses: number;
  averageMPG: number;
  totalGallons: number;
  totalMiles: number;
  averageCostPerGallon: number;
  averageCostPerMile: number;
  efficiencyTrend: Array<{
    date: Date;
    mpg: number;
    cost: number;
    mileage?: number;
    gallons?: number;
    costPerGallon?: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: string;
    date: Date;
    currentMPG?: number;
    averageMPG?: number;
  }>;
}

export interface CostPerMileApiResponse {
  totalCostPerMile: number;
  categoryBreakdown: {
    [category: string]: {
      cost: number;
      costPerMile: number;
    };
  };
  monthlyTrends: Array<{
    month: string;
    cost: number;
    estimatedMiles: number;
    costPerMile: number;
  }>;
  currentMileage: number;
  totalMiles: number;
  totalCost: number;
}

export interface ExpiringPoliciesResponse {
  data: InsurancePolicyResponse[];
  daysAhead: number;
}

// Helper function to assert API response types
export function assertApiResponse<T>(data: unknown): asserts data is ApiResponse<T> {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const response = data as Record<string, unknown>;
  if (typeof response.success !== 'boolean') {
    throw new Error('Response missing success field');
  }
}
