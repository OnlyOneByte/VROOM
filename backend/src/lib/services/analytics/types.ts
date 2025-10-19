// Types for analytics services
export type ExpenseData = {
  id: string;
  amount: number;
  category: string;
  type?: string | null;
  tags?: string[] | null;
  date: Date;
  description?: string | null;
  mileage?: number | null;
  volume?: number | null;
  charge?: number | null;
  vehicleId: string;
};

export type VehicleData = {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate?: string | null;
  nickname?: string | null;
  currentMileage?: number | null;
  initialMileage?: number | null;
  userId: string;
};

export type AnalyticsQuery = {
  startDate?: Date;
  endDate?: Date;
  groupBy: 'day' | 'week' | 'month' | 'year';
};

export type DashboardAnalytics = {
  vehicles: Array<{ id: string; name: string; nickname?: string | null }>;
  totalExpenses: number;
  monthlyTrends: Array<{ period: string; amount: number }>;
  categoryBreakdown: {
    [key: string]: { amount: number; count: number; percentage: number };
  };
  fuelEfficiency: {
    averageMPG: number;
    totalVolume: number;
    totalFuelCost: number;
    averageCostPerGallon: number;
  };
  costPerMile: {
    totalCostPerMile: number;
    totalCost: number;
    totalMiles: number;
  };
};

export type VehicleAnalytics = {
  vehicle: { id: string; name: string; nickname?: string | null };
  totalExpenses: number;
  monthlyTrends: Array<{ period: string; amount: number }>;
  categoryBreakdown: {
    [key: string]: { amount: number; count: number; percentage: number };
  };
  fuelEfficiency: {
    averageMPG: number;
    totalVolume: number;
    totalMiles: number;
    trend: Array<{ date: Date; mpg: number; mileage?: number }>;
  };
  costPerMile: {
    costPerMile: number;
    totalCost: number;
    totalMiles: number;
  };
};

export type TrendData = {
  costTrends: Array<{ period: string; amount: number }>;
  milesTrends: Array<{ period: string; miles: number }>;
  costPerMileTrends: Array<{ period: string; costPerMile: number }>;
};
