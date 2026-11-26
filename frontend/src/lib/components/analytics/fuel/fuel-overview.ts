import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';

export interface PriceSummary {
	fuelType: string;
	average: number;
	low: number;
	high: number;
	cheapestMonth: string;
	months: number;
}

function mainFuelType(history: FuelStatsResponse['gasPriceHistory']): string | null {
	const counts = new Map<string, number>();
	for (const item of history) counts.set(item.fuelType, (counts.get(item.fuelType) ?? 0) + 1);
	let best: string | null = null;
	for (const [type, count] of counts) {
		if (best == null || count > (counts.get(best) ?? 0)) best = type;
	}
	return best;
}

export function priceSummary(history: FuelStatsResponse['gasPriceHistory']): PriceSummary | null {
	const fuelType = mainFuelType(history);
	if (fuelType == null) return null;
	const fills = history.filter(item => item.fuelType === fuelType);
	const byMonth = new Map<string, { sum: number; count: number }>();
	let sum = 0;
	for (const item of fills) {
		sum += item.pricePerVolume;
		const month = byMonth.get(item.month) ?? { sum: 0, count: 0 };
		month.sum += item.pricePerVolume;
		month.count += 1;
		byMonth.set(item.month, month);
	}
	const monthly = [...byMonth].map(([month, m]) => ({ month, avg: m.sum / m.count }));
	const cheapest = monthly.reduce((a, b) => (b.avg < a.avg ? b : a));
	return {
		fuelType,
		average: sum / fills.length,
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
		.flatMap(v => (v.fuelEfficiencyValue == null ? [] : [{ ...v, value: v.fuelEfficiencyValue }]))
		.sort((a, b) => b.value - a.value);
	const max = rows[0]?.value ?? 0;
	return rows.map(v => ({
		vehicleId: v.vehicleId,
		label: v.vehicleName,
		value: v.value,
		share: max > 0 ? v.value / max : 0
	}));
}
