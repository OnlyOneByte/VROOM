// The six expense categories used throughout the app.
export type ExpenseCategory =
	| 'fuel'
	| 'maintenance'
	| 'financial'
	| 'regulatory'
	| 'enhancement'
	| 'misc';

// Common tag suggestions (not enforced)
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

// --- Expense splitting types ---

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
	receiptUrl?: string;
	isFinancingPayment: boolean;
	missedFillup?: boolean;
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
