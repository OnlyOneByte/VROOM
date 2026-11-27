import type { ExpenseCategory } from '#lib/constants/expense-categories.ts';

export type { ExpenseCategory };

export const CHARGER_TYPES = ['home', 'workplace', 'public_l2', 'dc_fast'] as const;
export type ChargerType = (typeof CHARGER_TYPES)[number];
export const CHARGER_TYPE_LABELS: Record<ChargerType, string> = {
	home: 'Home',
	workplace: 'Workplace',
	public_l2: 'Public Level 2',
	dc_fast: 'DC fast'
};

export const COMMON_EXPENSE_TAGS = [
	'fuel',
	'tolls',
	'parking',
	'maintenance',
	'repairs',
	'tires',
	'oil-change',
	'insurance',
	'loan-payment',
	'registration',
	'inspection',
	'emissions',
	'tickets',
	'modifications',
	'accessories',
	'detailing',
	'car-wash',
	'wax',
	'interior-cleaning',
	'emergency',
	'routine'
] as const;

export type SplitConfig =
	| { method: 'even'; vehicleIds: string[] }
	| { method: 'absolute'; allocations: Array<{ vehicleId: string; amount: number }> }
	| { method: 'percentage'; allocations: Array<{ vehicleId: string; percentage: number }> };

export interface Expense {
	id: string;
	vehicleId: string;
	userId: string;
	tags: string[];
	category: ExpenseCategory;
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	volume?: number;
	charge?: number;
	fuelType?: string;
	chargerType?: ChargerType | null;
	description?: string;
	location?: string;
	missedFillup?: boolean;
	sourceType?: string;
	sourceId?: string;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
	paidByDriverId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SplitExpenseGroup {
	siblings: Expense[];
	groupId: string;
	groupTotal: number;
	splitMethod: string;
}

export interface ExpenseSummary {
	totalAmount: number;
	expenseCount: number;
	monthlyAverage: number;
	recentAmount: number;
	categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
	monthlyTrend: Array<{ period: string; amount: number; count: number }>;
	costBuckets: ExpenseCostBuckets;
}

export interface CostBucketTotals {
	ownershipTotal: number;
	runningTotal: number;
}

export interface ExpenseCostBuckets extends CostBucketTotals {
	previous: CostBucketTotals | null;
	byVehicle: Array<CostBucketTotals & { vehicleId: string; previous: CostBucketTotals | null }>;
}

export interface BackendExpenseResponse {
	id: string;
	vehicleId: string;
	userId: string;
	tags: string[];
	category: string;
	expenseAmount: number;
	date: string;
	mileage?: number;
	volume?: number;
	fuelType?: string | null;
	chargerType?: ChargerType | null;
	description?: string | null;
	location?: string | null;
	missedFillup?: boolean;
	paidByDriverId?: string | null;
	sourceType?: string | null;
	sourceId?: string | null;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
	clientId?: string | null;
	createdAt: string;
	updatedAt: string;
}
