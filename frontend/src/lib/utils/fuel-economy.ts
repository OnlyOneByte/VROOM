export interface EconomyPoint {
	date: Date;
	efficiency: number;
}

export interface EconomyOutlier {
	month: Date;
	efficiency: number;
	count: number;
	direction: 'below' | 'above';
}

const OUTLIER_SHARE = 0.15;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function lastTwelveMonths<T extends { date: Date }>(points: T[], now = new Date()): T[] {
	const since = now.getTime() - YEAR_MS;
	return points.filter(point => point.date.getTime() >= since);
}

export function bestEfficiency(points: EconomyPoint[]): number | null {
	return points.length > 0 ? Math.max(...points.map(point => point.efficiency)) : null;
}

export function monthOutlier(
	points: EconomyPoint[],
	average: number | null
): EconomyOutlier | null {
	if (average === null || !(average > 0) || points.length < 2) return null;
	const months = new Map<string, { month: Date; total: number; count: number }>();
	for (const { date, efficiency } of points) {
		const key = `${date.getFullYear()}-${date.getMonth()}`;
		const bucket = months.get(key) ?? {
			month: new Date(date.getFullYear(), date.getMonth(), 1),
			total: 0,
			count: 0
		};
		bucket.total += efficiency;
		bucket.count += 1;
		months.set(key, bucket);
	}
	if (months.size < 2) return null;
	const monthly = [...months.values()].map(({ month, total, count }) => ({
		month,
		efficiency: total / count,
		count
	}));
	const lowest = monthly.reduce((a, b) => (b.efficiency < a.efficiency ? b : a));
	if (lowest.efficiency < average * (1 - OUTLIER_SHARE)) return { ...lowest, direction: 'below' };
	const highest = monthly.reduce((a, b) => (b.efficiency > a.efficiency ? b : a));
	if (highest.efficiency > average * (1 + OUTLIER_SHARE)) return { ...highest, direction: 'above' };
	return null;
}
