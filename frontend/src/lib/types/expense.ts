export type ExpenseCategory =
	'fuel' | 'maintenance' | 'financial' | 'regulatory' | 'enhancement' | 'misc';

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
	description?: string;
	location?: string;
	missedFillup?: boolean;
	sourceType?: string;
	sourceId?: string;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
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
	fuelType?: string;
	description?: string | null;
	location?: string | null;
	missedFillup?: boolean;
	sourceType?: string;
	sourceId?: string;
	groupId?: string;
	groupTotal?: number;
	splitMethod?: string;
	createdAt: string;
	updatedAt: string;
}
