import type { UnitsMetadata } from './settings.js';
import type { ExpenseCategory } from './expense.js';

export interface FuelEfficiencyPoint {
	date: string;
	efficiency: number;
	mileage: number;
}

export interface QuickStatsResponse {
	vehicleCount: number;
	ytdSpending: number;
	avgEfficiency: number | null;
	costPerDistance: number | null;
	fleetHealthScore: number;
	units: UnitsMetadata;
}

export interface FuelStatsResponse {
	fillups: {
		currentYear: number;
		previousYear: number;
		currentMonth: number;
		previousMonth: number;
	};
	volume: {
		currentYear: number;
		previousYear: number;
		currentMonth: number;
		previousMonth: number;
	};
	fuelConsumption: {
		avgEfficiency: number | null;
		bestEfficiency: number | null;
		worstEfficiency: number | null;
	};
	fillupDetails: {
		avgVolume: number | null;
		minVolume: number | null;
		maxVolume: number | null;
	};
	averageCost: {
		perFillup: number | null;
		bestCostPerDistance: number | null;
		worstCostPerDistance: number | null;
		avgCostPerDay: number | null;
		costPerDistance?: number | null;
	};
	monthlySpend?: { months: number; fuel: number | null; charging: number | null } | null;
	previous?: {
		costPerDistance: number | null;
		monthlySpend: { months: number; fuel: number | null; charging: number | null } | null;
		avgEfficiency: number | null;
		chargeAvgEfficiency: number | null;
	};
	distance: {
		totalDistance: number;
		avgPerDay: number | null;
		avgPerMonth: number | null;
	};
	monthlyConsumption: Array<{ month: string; efficiency: number | null; volume: number }>;
	gasPriceHistory: Array<{ date: string; month: string; fuelType: string; pricePerVolume: number }>;
	fillupCostByVehicle: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		avgCost: number;
	}>;
	odometerProgression: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		mileage: number;
	}>;
	costPerDistance: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		costPerDistance: number;
	}>;
	charging?: {
		sessions: PeriodCounts;
		energy: PeriodCounts;
		efficiency: {
			avgEfficiency: number | null;
			bestEfficiency: number | null;
			worstEfficiency: number | null;
		};
		sessionDetails: {
			avgEnergy: number | null;
			minEnergy: number | null;
			maxEnergy: number | null;
		};
		averageCost: { perSession: number | null; perEnergyUnit: number | null };
		priceHistory: Array<{ date: string; month: string; fuelType: string; pricePerVolume: number }>;
	};
	units?: UnitsMetadata;
}

export interface PeriodCounts {
	currentYear: number;
	previousYear: number;
	currentMonth: number;
	previousMonth: number;
}

export interface FuelAdvancedResponse {
	maintenanceTimeline: Array<{
		vehicleId: string;
		vehicleName: string;
		service: string;
		lastServiceDate: string;
		nextDueDate: string;
		daysRemaining: number;
		status: 'good' | 'warning' | 'overdue';
	}>;
	seasonalEfficiency: Array<{
		season: string;
		avgEfficiency: number;
		fillupCount: number;
	}>;
	vehicleRadar: Array<{
		vehicleId: string;
		vehicleName: string;
		fuelEfficiency: number | null;
		maintenanceCost: number;
		reliability: number;
		annualCost: number;
		mileage: number;
	}>;
	dayOfWeekPatterns: Array<{
		day: string;
		fillupCount: number;
		avgCost: number;
		avgVolume: number;
	}>;
	monthlyCostHeatmap: Array<{ month: string } & Record<ExpenseCategory, number>>;
	fillupIntervals: Array<{
		intervalLabel: string;
		count: number;
	}>;
}

export interface AnalyticsSummaryResponse {
	quickStats: QuickStatsResponse;
	fuelStats: FuelStatsResponse;
	fuelAdvanced: FuelAdvancedResponse;
}

export interface CrossVehicleResponse {
	monthlyExpenseTrends: Array<{ month: string; amount: number }>;
	expenseByCategory: Array<{
		category: string;
		amount: number;
		percentage: number;
	}>;
	vehicleCostComparison: Array<{
		vehicleId: string;
		vehicleName: string;
		totalCost: number;
		costPerDistance: number | null;
	}>;
	fuelEfficiencyComparison: Array<{
		month: string;
		vehicles: Array<{ vehicleId: string; vehicleName: string; efficiency: number }>;
	}>;
	units?: UnitsMetadata;
}

export interface FinancingResponse {
	summary: {
		totalMonthlyPayments: number;
		remainingBalance: number;
		monthlyInterestEstimate: number;
		activeCount: number;
		loanCount: number;
		leaseCount: number;
	};
	vehicleDetails: Array<{
		vehicleId: string;
		vehicleName: string;
		financingType: 'loan' | 'lease' | 'own';
		monthlyPayment: number;
		remainingBalance: number;
		apr: number | null;
		monthlyInterestEstimate: number;
		monthsRemaining: number;
	}>;
	monthlyTimeline: Array<{
		month: string;
		vehicles: Array<{ vehicleId: string; vehicleName: string; amount: number }>;
	}>;
	typeDistribution: Array<{
		type: string;
		value: number;
		count: number;
	}>;
	loanBreakdown: Array<{
		month: string;
		interest: number;
		principal: number;
	}>;
}

export interface InsuranceResponse {
	summary: {
		totalMonthlyPremiums: number;
		totalAnnualPremiums: number;
		activePoliciesCount: number;
	};
	vehicleDetails: Array<{
		vehicleId: string;
		vehicleName: string;
		carrier: string;
		monthlyPremium: number;
		annualPremium: number;
		deductible: number | null;
		coverageType: string | null;
	}>;
	monthlyPremiumTrend: Array<{ month: string; premiums: number }>;
	costByCarrier: Array<{ carrier: string; annualPremium: number; vehicleCount: number }>;
}

export interface VehicleHealthResponse {
	vehicleId: string;
	vehicleName: string;
	overallScore: number;
	maintenanceRegularity: number;
	mileageIntervalAdherence: number;
	insuranceCoverage: number;
}

export interface VehicleTCOResponse {
	vehicleId: string;
	vehicleName: string;
	purchasePrice: number | null;
	financingInterest: number;
	insuranceCost: number;
	fuelCost: number;
	maintenanceCost: number;
	otherCosts: number;
	totalCost: number;
	ownershipMonths: number;
	totalDistance: number;
	costPerDistance: number | null;
	costPerMonth: number;
}

export interface VehicleExpensesResponse {
	maintenanceCosts: Array<{ month: string; cost: number }>;
	fuelEfficiencyAndCost: Array<{ month: string; efficiency: number | null; cost: number }>;
	expenseBreakdown: Array<{ category: string; amount: number }>;
}

export interface YearEndResponse {
	year: number;
	totalSpent: number;
	categoryBreakdown: Array<{
		category: string;
		amount: number;
		percentage: number;
	}>;
	efficiencyTrend: Array<{ month: string; efficiency: number }>;
	biggestExpense: {
		description: string;
		amount: number;
		date: string;
	} | null;
	previousYearComparison: {
		totalSpent: number;
		percentageChange: number;
	} | null;
	vehicleCount: number;
	totalDistance: number;
	avgEfficiency: number | null;
	costPerDistance: number | null;
	units?: UnitsMetadata;
}

export type AnalyticsQueryMetric =
	'cost' | 'costPerDistance' | 'distance' | 'volume' | 'efficiency' | 'count';
export type AnalyticsQueryInterval = 'week' | 'month' | 'quarter' | 'year' | 'none';
export type AnalyticsQueryGroupBy = 'none' | 'category' | 'vehicle' | 'fuelType' | 'tag' | 'driver';
export type AnalyticsQueryInclude = 'running' | 'all';
export type AnalyticsQueryCompare = 'none' | 'prevPeriod' | 'prevYear';
export type AnalyticsQueryEnergy = 'fuel' | 'electric';

export interface AnalyticsQueryParams {
	metric: AnalyticsQueryMetric;
	interval?: AnalyticsQueryInterval;
	groupBy?: AnalyticsQueryGroupBy;
	vehicleIds?: string[];
	categories?: ExpenseCategory[];
	start?: number;
	end?: number;
	include?: AnalyticsQueryInclude;
	compare?: AnalyticsQueryCompare;
	energy?: AnalyticsQueryEnergy;
	annotations?: Array<'services' | 'trips'>;
}

export interface AnalyticsQuerySeries {
	key: string;
	label: string;
	values: Array<number | null>;
}

export interface AnalyticsQueryPeriod {
	range: { start: number; end: number };
	buckets: string[];
	series: AnalyticsQuerySeries[];
	totals: {
		value: number | null;
		perBucket: number | null;
		perDistance: number | null;
		distance: number;
	};
}

export interface AnalyticsQueryResponse extends AnalyticsQueryPeriod {
	metric: AnalyticsQueryMetric;
	unit: string;
	interval: AnalyticsQueryInterval;
	groupBy: AnalyticsQueryGroupBy;
	compare: AnalyticsQueryPeriod | null;
	annotations?: Array<{
		t: number;
		kind: 'service';
		vehicleId: string;
		vehicleName: string;
		label: string;
		amount: number;
	}>;
	annotationsTruncated?: boolean;
	trips?: { count: number[]; distance: number[] };
}

export interface AnalyticsBucketItemsParams {
	start: number;
	end: number;
	vehicleIds?: string[];
	include?: AnalyticsQueryInclude;
	metric?: AnalyticsQueryMetric;
	energy?: AnalyticsQueryEnergy;
	groupBy?: AnalyticsQueryGroupBy;
	keys?: string[];
}

export interface AnalyticsBucketItems {
	total: number;
	count: number;
	fuel: { total: number; count: number } | null;
	items: Array<{
		id: string;
		date: number;
		category: string;
		vehicleId: string;
		vehicleName: string;
		description: string | null;
		amount: number;
	}>;
	others: { total: number; count: number } | null;
	categories: string[];
}

export interface AnalyticsInsight {
	id: 'recordMonth' | 'repairFree' | 'winterPenalty' | 'costPerTrip' | 'cheapestStation';
	title: string;
	value: number;
	unit: 'money' | 'days' | 'percent' | 'moneyPerVolume';
	sentence: string;
	query: Record<string, string>;
}
