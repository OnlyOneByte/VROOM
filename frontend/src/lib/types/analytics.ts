import type { UnitsMetadata } from './settings.js';

export interface FuelEfficiencyPoint {
	date: string;
	efficiency: number;
	mileage: number;
}

export interface QuickStatsResponse {
	vehicleCount: number;
	ytdSpending: number;
	avgEfficiency: number | null;
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
	};
	distance: {
		totalDistance: number;
		avgPerDay: number | null;
		avgPerMonth: number | null;
	};
	monthlyConsumption: Array<{ month: string; efficiency: number; volume: number }>;
	gasPriceHistory: Array<{ date: string; fuelType: string; pricePerVolume: number }>;
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
	units?: UnitsMetadata;
}

export interface FuelAdvancedResponse {
	maintenanceTimeline: Array<{
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
		fuelEfficiency: number;
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
	monthlyCostHeatmap: Array<{
		month: string;
		fuel: number;
		maintenance: number;
		financial: number;
		regulatory: number;
		enhancement: number;
		misc: number;
	}>;
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
		interestPaidYtd: number;
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
		interestPaid: number;
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
	monthlyTrend: Array<{
		month: string;
		financing: number;
		insurance: number;
		fuel: number;
		maintenance: number;
	}>;
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
