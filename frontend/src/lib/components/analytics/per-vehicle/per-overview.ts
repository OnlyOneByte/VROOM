import type { ExpenseCategory } from '#lib/constants/expense-categories.ts';
import type { AnalyticsQueryParams, AnalyticsQueryResponse } from '#lib/types/index.ts';
import { getCategoryLabel } from '#lib/utils/chart-colors.ts';
import { REASONS } from '../cross-vehicle/cross-overview';

export function perVehicleRequests(
	vehicleId: string,
	range: { startDate: number; endDate: number }
): { lifetime: AnalyticsQueryParams[]; monthly: AnalyticsQueryParams } {
	const car = { vehicleIds: [vehicleId], interval: 'none' as const };
	return {
		lifetime: [
			{ ...car, metric: 'cost', groupBy: 'category', include: 'all' },
			{ ...car, metric: 'costPerDistance', include: 'all' },
			{ ...car, metric: 'costPerDistance', include: 'running' }
		],
		monthly: {
			...car,
			metric: 'cost',
			interval: 'month',
			include: 'running',
			start: range.startDate,
			end: range.endDate
		}
	};
}

export function singleValue(response: AnalyticsQueryResponse | null | undefined): number | null {
	return response?.series[0]?.values[0] ?? null;
}

export interface CategoryRow {
	category: ExpenseCategory;
	label: string;
	value: number;
	share: number;
}

export function categoryRows(
	response: AnalyticsQueryResponse | null | undefined,
	hideFinancial: boolean
): CategoryRow[] {
	const rows = (response?.series ?? [])
		.flatMap(s => {
			const value = s.values[0];
			if (value == null || value <= 0 || (hideFinancial && s.key === 'financial')) return [];
			const category = s.key as ExpenseCategory;
			return [{ category, label: getCategoryLabel(category), value }];
		})
		.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
	const max = rows[0]?.value ?? 0;
	return rows.map(r => ({ ...r, share: max > 0 ? r.value / max : 0 }));
}

export interface PerHero {
	total: number;
	top?: { percent: number; reason: string };
	running?: number;
}

export function perHero(rows: CategoryRow[]): PerHero | null {
	const total = rows.reduce((sum, r) => sum + r.value, 0);
	if (total <= 0) return null;
	const first = rows[0] as CategoryRow;
	const top =
		first.value / total >= 0.4
			? { percent: Math.round((first.value / total) * 100), reason: REASONS[first.category] }
			: undefined;
	const financial = rows.find(r => r.category === 'financial')?.value ?? 0;
	return { total, top, running: financial > 0 ? total - financial : undefined };
}
