import { EXPENSE_CATEGORIES, type ExpenseCategory } from '#lib/constants/expense-categories.ts';
import type { TimePeriod } from '#lib/constants/time-periods.ts';
import type { ExpenseSummary, InsurancePolicy, ReminderWithVehicles } from '#lib/types/index.ts';
import {
	bucketAmounts,
	costBucket,
	type BucketAmounts,
	type CostBucket
} from '#lib/utils/cost-bucket.ts';
import { formatNumber } from '#lib/utils/formatters.ts';
import { soonDistance } from '#lib/utils/reminder-helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REMINDER_WINDOW_DAYS = 14;
export const RENEWAL_WINDOW_DAYS = 60;
export const LAPSED_RENEWAL_DAYS = 30;

export const RUNNING_CATEGORIES: ExpenseCategory[] = EXPENSE_CATEGORIES.filter(
	category => costBucket(category) !== 'ownership'
);

export const PERIOD_DAYS: Record<Exclude<TimePeriod, 'all'>, number> = {
	'7d': 7,
	'30d': 30,
	'90d': 90,
	'1y': 365
};

export const PERIOD_PHRASES: Record<TimePeriod, { label: string; chip: string; previous: string }> =
	{
		'7d': { label: 'Spent in the last 7 days', chip: '7 days', previous: 'the 7 days before' },
		'30d': { label: 'Spent in the last 30 days', chip: '30 days', previous: 'the 30 days before' },
		'90d': { label: 'Spent in the last 90 days', chip: '90 days', previous: 'the 90 days before' },
		'1y': {
			label: 'Spent in the last 12 months',
			chip: '12 months',
			previous: 'the 12 months before'
		},
		all: { label: 'Spent all time', chip: 'All time', previous: '' }
	};

export interface VehicleRow {
	id: string;
	name: string;
	detail: string;
	spend: number;
	runningPerDistance: number | null;
}

/**
 * Explains a vehicle row's "—". The rows' distance comes from odometer readings on expenses
 * (not the starting odometer or standalone odometer entries), so it needs two of them.
 */
export function noPerDistanceNote(distanceLabel: string): string {
	return `— means no cost per ${distanceLabel} yet. It needs odometer readings on two expenses, such as two fill-ups.`;
}

export interface PeriodSpend {
	total: number;
	previousTotal: number | null;
	buckets: BucketAmounts;
	byVehicle: Map<string, number>;
}

export function periodStartSeconds(period: TimePeriod, now: number): number {
	if (period === 'all') return 1;
	return Math.floor((now - PERIOD_DAYS[period] * DAY_MS) / 1000);
}

export function combinePeriodSpend(summaries: ExpenseSummary[]): PeriodSpend {
	const buckets: BucketAmounts = { ownership: 0, energy: 0, upkeep: 0 };
	const byVehicle = new Map<string, number>();
	let total = 0;
	let previousTotal: number | null = null;
	for (const summary of summaries) {
		total += summary.totalAmount;
		const amounts = bucketAmounts(summary.categoryBreakdown);
		for (const bucket of Object.keys(buckets) as CostBucket[]) buckets[bucket] += amounts[bucket];
		const previous = summary.costBuckets?.previous;
		if (previous) {
			previousTotal = (previousTotal ?? 0) + previous.ownershipTotal + previous.runningTotal;
		}
		for (const row of summary.costBuckets?.byVehicle ?? []) {
			byVehicle.set(
				row.vehicleId,
				(byVehicle.get(row.vehicleId) ?? 0) + row.ownershipTotal + row.runningTotal
			);
		}
	}
	return { total, previousTotal, buckets, byVehicle };
}

export function percentChange(current: number, previous: number | null): number | null {
	if (previous === null || previous <= 0) return null;
	return Math.round(((current - previous) / previous) * 100);
}

export interface AttentionItem {
	id: string;
	title: string;
	detail: string;
	status: 'overdue' | 'soon';
	dueAt: number;
	href: 'reminders' | 'insurance';
	action?: { label: string; href: string };
}

export function attentionItems(
	reminders: ReminderWithVehicles[],
	policies: InsurancePolicy[],
	vehicleName: (id: string) => string | undefined,
	formatDay: (date: Date) => string,
	now: number,
	distanceLabel: (vehicleId: string) => string = () => 'mi'
): AttentionItem[] {
	const reminderHorizon = now + REMINDER_WINDOW_DAYS * DAY_MS;
	const renewalHorizon = now + RENEWAL_WINDOW_DAYS * DAY_MS;
	const lapsedSince = now - LAPSED_RENEWAL_DAYS * DAY_MS;
	const items: AttentionItem[] = [];

	for (const { reminder, vehicleIds, mileageDue, currentOdometer } of reminders) {
		if (!reminder.isActive) continue;
		const names = vehicleIds.map(vehicleName).filter(Boolean).join(', ');
		const title = names ? `${reminder.name} · ${names}` : reminder.name;
		const unit = distanceLabel(vehicleIds[0] ?? '');
		if (mileageDue && reminder.nextDueOdometer !== null) {
			items.push({
				id: `reminder-${reminder.id}`,
				title,
				detail: `Reached ${formatNumber(reminder.nextDueOdometer, 0)} ${unit}`,
				status: 'overdue',
				dueAt: now,
				href: 'reminders'
			});
			continue;
		}
		const dueAt = reminder.nextDueDate ? new Date(reminder.nextDueDate).getTime() : Infinity;
		if (dueAt > reminderHorizon) {
			const target = reminder.nextDueOdometer;
			const left =
				typeof currentOdometer === 'number' && target !== null ? target - currentOdometer : null;
			if (left !== null && left > 0 && left <= soonDistance(unit)) {
				items.push({
					id: `reminder-${reminder.id}`,
					title,
					detail: `Due in ${formatNumber(left, 0)} ${unit}`,
					status: 'soon',
					dueAt: reminderHorizon,
					href: 'reminders'
				});
			}
			continue;
		}
		const overdue = dueAt <= now;
		items.push({
			id: `reminder-${reminder.id}`,
			title,
			detail: `${overdue ? 'Was due' : 'Due'} ${formatDay(new Date(dueAt))}`,
			status: overdue ? 'overdue' : 'soon',
			dueAt,
			href: 'reminders'
		});
	}

	for (const policy of policies) {
		if (!policy.isActive || policy.terms.length === 0) continue;
		const endAt = Math.max(...policy.terms.map(term => new Date(term.endDate).getTime()));
		if (endAt > renewalHorizon || endAt < lapsedSince) continue;
		const overdue = endAt <= now;
		items.push({
			id: `policy-${policy.id}`,
			title: `${policy.company} renewal`,
			detail: `${overdue ? 'Ended' : 'Ends'} ${formatDay(new Date(endAt))}`,
			status: overdue ? 'overdue' : 'soon',
			dueAt: endAt,
			href: 'insurance'
		});
	}

	const rank = (item: AttentionItem) => (item.status === 'overdue' ? 0 : 1);
	return items.sort((a, b) => rank(a) - rank(b) || a.dueAt - b.dueAt);
}

export function highestMonth(
	months: Array<{ date: Date; amount: number }>
): { date: Date; amount: number } | null {
	let best: { date: Date; amount: number } | null = null;
	for (const month of months) {
		if (month.amount > 0 && (!best || month.amount > best.amount)) best = month;
	}
	return best;
}
