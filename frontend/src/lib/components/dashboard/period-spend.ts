import { expenseApi } from '#lib/services/expense-api.ts';
import { analyticsApi } from '#lib/services/analytics-api.ts';
import type { ExpenseSummary, Vehicle } from '#lib/types/index.ts';
import type { AnalyticsQueryResponse } from '#lib/types/analytics.ts';
import type { TimePeriod } from '#lib/constants/time-periods.ts';
import { RUNNING_CATEGORIES, periodStartSeconds } from './dashboard-data';

export interface PeriodData {
	summaries: ExpenseSummary[];
	perDistance: AnalyticsQueryResponse | null;
}

export function sharedSummaries(
	selected: TimePeriod,
	shared: Vehicle[]
): Promise<ExpenseSummary[]> {
	return Promise.all(
		shared.map(v =>
			expenseApi.getExpenseSummary({ vehicleId: v.id, period: selected }).catch(() => null)
		)
	).then(rows => rows.filter((row): row is ExpenseSummary => row !== null));
}

export async function loadPeriodSpend(
	selected: TimePeriod,
	shared: Vehicle[]
): Promise<PeriodData> {
	const nowSec = Math.floor(Date.now() / 1000);
	const [owned, perDistance, sharedRows] = await Promise.all([
		expenseApi.getExpenseSummary({ period: selected }),
		analyticsApi
			.query({
				metric: 'costPerDistance',
				interval: 'none',
				groupBy: 'vehicle',
				include: 'all',
				categories: RUNNING_CATEGORIES,
				start: periodStartSeconds(selected, Date.now()),
				end: nowSec
			})
			.catch(() => null),
		sharedSummaries(selected, shared)
	]);
	return { summaries: [owned, ...sharedRows], perDistance };
}
