import { EXPENSE_CATEGORIES, type ExpenseCategory } from '#lib/constants/expense-categories.ts';
import type { AnalyticsQueryParams, AnalyticsQueryResponse } from '#lib/types/index.ts';
import { getCategoryLabel } from '#lib/utils/chart-colors.ts';

export const MATRIX_CARS = 5;

export interface CarValue {
	vehicleId: string;
	label: string;
	value: number;
	share: number;
}

export function overviewRequests(
	range: { startDate: number; endDate: number },
	vehicleIds?: string[]
): {
	running: AnalyticsQueryParams;
	allIn: AnalyticsQueryParams;
	categories: AnalyticsQueryParams[];
} {
	const perCar = { interval: 'none', groupBy: 'vehicle', vehicleIds } as const;
	return {
		running: {
			...perCar,
			metric: 'costPerDistance',
			include: 'running',
			start: range.startDate,
			end: range.endDate
		},
		allIn: { ...perCar, metric: 'costPerDistance', include: 'all' },
		categories: EXPENSE_CATEGORIES.map(category => ({
			...perCar,
			metric: 'cost',
			include: 'all',
			categories: [category]
		}))
	};
}

export function carValues(response: AnalyticsQueryResponse | null | undefined): CarValue[] {
	const rows = (response?.series ?? [])
		.flatMap(s => {
			const value = s.values[0];
			return value == null ? [] : [{ vehicleId: s.key, label: s.label, value }];
		})
		.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
	const max = rows[0]?.value ?? 0;
	return rows.map(r => ({ ...r, share: max > 0 ? r.value / max : 0 }));
}

export interface CategoryMatrix {
	cars: Array<{ vehicleId: string; label: string; total: number }>;
	more: number;
	rows: Array<{ category: ExpenseCategory; label: string; amounts: Array<number | null> }>;
}

export function categoryMatrix(
	byCategory: Array<AnalyticsQueryResponse | null>,
	hiddenFinancials: ReadonlySet<string>
): CategoryMatrix {
	const amounts = new Map<string, Map<ExpenseCategory, number>>();
	const labels = new Map<string, string>();
	EXPENSE_CATEGORIES.forEach((category, i) => {
		for (const s of byCategory[i]?.series ?? []) {
			labels.set(s.key, s.label);
			if (category === 'financial' && hiddenFinancials.has(s.key)) continue;
			const car = amounts.get(s.key) ?? new Map<ExpenseCategory, number>();
			car.set(category, s.values[0] ?? 0);
			amounts.set(s.key, car);
		}
	});
	const ranked = [...labels]
		.map(([vehicleId, label]) => ({
			vehicleId,
			label,
			total: [...(amounts.get(vehicleId)?.values() ?? [])].reduce((a, b) => a + b, 0)
		}))
		.filter(car => car.total > 0)
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
	const cars = ranked.slice(0, MATRIX_CARS);
	const rows = EXPENSE_CATEGORIES.flatMap(category => {
		const row = cars.map(car => {
			if (category === 'financial' && hiddenFinancials.has(car.vehicleId)) return null;
			return amounts.get(car.vehicleId)?.get(category) ?? 0;
		});
		return row.some(v => v != null && v > 0)
			? [{ category, label: getCategoryLabel(category), amounts: row }]
			: [];
	});
	return { cars, more: ranked.length - cars.length, rows };
}

const REASONS: Record<ExpenseCategory, string> = {
	fuel: 'fuel and charging',
	maintenance: 'maintenance',
	financial: 'loan and insurance payments',
	regulatory: 'registration and fees',
	enhancement: 'upgrades',
	misc: 'other costs'
};

export interface CrossHero {
	cheapest: string;
	costliest: string;
	reason?: string;
}

export function crossHero(
	running: CarValue[],
	allIn: CarValue[],
	byCategory: Array<AnalyticsQueryResponse | null>,
	hiddenFinancials: ReadonlySet<string>
): CrossHero | null {
	if (running.length < 2 || allIn.length < 2) return null;
	const cheapest = running.at(-1) as CarValue;
	const costliest = allIn[0] as CarValue;
	const visible = EXPENSE_CATEGORIES.flatMap((category, i) => {
		if (category === 'financial' && hiddenFinancials.has(costliest.vehicleId)) return [];
		const value = byCategory[i]?.series.find(s => s.key === costliest.vehicleId)?.values[0] ?? 0;
		return value > 0 ? [{ category, value }] : [];
	});
	const total = visible.reduce((sum, c) => sum + c.value, 0);
	const top = visible.sort((a, b) => b.value - a.value)[0];
	const reason = top && top.value / total >= 0.4 ? REASONS[top.category] : undefined;
	return { cheapest: cheapest.label, costliest: costliest.label, reason };
}
