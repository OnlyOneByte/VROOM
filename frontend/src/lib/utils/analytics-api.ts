// Analytics API - Stubbed (backend endpoints removed)

export interface DashboardData {
	vehicles: Array<{
		id: string;
		name: string;
		nickname?: string;
	}>;
	totalExpenses: number;
	monthlyTrends: Array<{
		period: string;
		amount: number;
	}>;
	categoryBreakdown: {
		[category: string]: {
			amount: number;
			count: number;
			percentage: number;
		};
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
}

export interface VehicleAnalytics {
	vehicle: {
		id: string;
		name: string;
		nickname?: string;
	};
	totalExpenses: number;
	monthlyTrends: Array<{
		period: string;
		amount: number;
	}>;
	categoryBreakdown: {
		[category: string]: {
			amount: number;
			count: number;
			percentage: number;
		};
	};
	fuelEfficiency: {
		averageMPG: number;
		totalVolume: number;
		totalMiles: number;
		trend: Array<{
			date: string;
			mpg: number;
			mileage: number;
		}>;
	};
	costPerMile: {
		costPerMile: number;
		totalCost: number;
		totalMiles: number;
	};
}

export interface TrendData {
	costTrends: Array<{
		period: string;
		amount: number;
	}>;
	milesTrends: Array<{
		period: string;
		miles: number;
	}>;
	costPerMileTrends: Array<{
		period: string;
		costPerMile: number;
	}>;
}

// NOTE: Analytics endpoints removed from backend - these functions are stubbed
// TODO: Implement client-side analytics calculations or remove analytics features

export async function getDashboardAnalytics(
	_startDate?: string,
	_endDate?: string,
	_groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<DashboardData> {
	// Stubbed - analytics endpoint removed
	throw new Error('Analytics endpoint not implemented');
}

export async function getVehicleAnalytics(
	_vehicleId: string,
	_startDate?: string,
	_endDate?: string,
	_groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<VehicleAnalytics> {
	// Stubbed - analytics endpoint removed
	throw new Error('Analytics endpoint not implemented');
}

export async function getTrendData(
	_startDate?: string,
	_endDate?: string,
	_groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<TrendData> {
	// Stubbed - analytics endpoint removed
	throw new Error('Analytics endpoint not implemented');
}

export async function getFuelEfficiency(_vehicleId: string) {
	// Stubbed - analytics endpoint removed
	throw new Error('Analytics endpoint not implemented');
}

export async function getCostPerMile(_vehicleId: string) {
	// Stubbed - analytics endpoint removed
	throw new Error('Analytics endpoint not implemented');
}
