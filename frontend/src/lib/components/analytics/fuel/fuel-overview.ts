import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';

export interface PriceSummary {
	average: number;
	low: number;
	high: number;
	cheapestMonth: string;
	months: number;
}

export function priceSummary(history: FuelStatsResponse['gasPriceHistory']): PriceSummary | null {
	if (history.length === 0) return null;
	const byMonth = new Map<string, { sum: number; count: number }>();
	let sum = 0;
	for (const item of history) {
		sum += item.pricePerVolume;
		const month = byMonth.get(item.month) ?? { sum: 0, count: 0 };
		month.sum += item.pricePerVolume;
		month.count += 1;
		byMonth.set(item.month, month);
	}
	const monthly = [...byMonth].map(([month, m]) => ({ month, avg: m.sum / m.count }));
	const cheapest = monthly.reduce((a, b) => (b.avg < a.avg ? b : a));
	return {
		average: sum / history.length,
		low: cheapest.avg,
		high: Math.max(...monthly.map(m => m.avg)),
		cheapestMonth: cheapest.month,
		months: monthly.length
	};
}

export interface EconomyRow {
	vehicleId: string;
	label: string;
	value: number;
	share: number;
}

export function economyRows(radar: FuelAdvancedResponse['vehicleRadar']): EconomyRow[] {
	const rows = radar
		.filter((v): v is typeof v & { fuelEfficiency: number } => v.fuelEfficiency != null)
		.sort((a, b) => b.fuelEfficiency - a.fuelEfficiency);
	const max = rows[0]?.fuelEfficiency ?? 0;
	return rows.map(v => ({
		vehicleId: v.vehicleId,
		label: v.vehicleName,
		value: v.fuelEfficiency,
		share: max > 0 ? v.fuelEfficiency / max : 0
	}));
}
