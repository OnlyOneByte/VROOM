// API Response Types

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  session: {
    id: string;
  };
}

export interface LogoutResponse {
  message: string;
}

export interface ExpenseResponse {
  id: string;
  tags: string[];
  category: string;
  amount: number;
  vehicleId: string;
  description?: string;
  date: Date;
  mileage?: number;
  volume?: number;
  charge?: number;
}

export interface VehicleResponse {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate?: string;
  nickname?: string;
  userId: string;
}

export interface InsuranceResponse {
  id: string;
  company: string;
  policyNumber?: string;
  totalCost: number;
  monthlyCost: number;
  startDate: Date;
  endDate: Date;
  vehicleId: string;
  termLengthMonths: number;
  isActive: boolean;
}

export interface ExpenseListResponse {
  data: ExpenseResponse[];
  filters: {
    tags?: string[];
    category?: string;
    vehicleId?: string;
  };
}

export interface FuelAnalyticsResponse {
  totalFuelExpenses: number;
  averageMPG: number;
  efficiencyTrend: Array<{
    date: Date;
    mpg: number;
    costPerMile: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: string;
  }>;
}

export interface InsuranceBreakdownResponse {
  breakdown: Array<{
    cost: number;
    monthName: string;
    startDate: Date;
    endDate: Date;
  }>;
}

export interface ExpiringInsuranceResponse {
  data: Array<{
    id: string;
    company: string;
    daysUntilExpiration: number;
    expirationAlert: {
      type: string;
      severity: string;
      message: string;
    };
  }>;
  daysAhead: number;
}

export interface CostBreakdownResponse {
  categoryBreakdown: {
    [category: string]: {
      cost: number;
      count: number;
    };
  };
  totalCost: number;
}
