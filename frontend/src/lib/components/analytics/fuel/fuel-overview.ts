import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
import { CHARGER_TYPE_LABELS } from '#lib/types/index.ts';

export interface PriceSummary {
	fuelType: string;
	average: number;
	low: number;
	high: number;
	cheapestMonth: string;
	months: number;
}

type PriceEntry = FuelStatsResponse['gasPriceHistory'][number];

function mainFuelType(history: PriceEntry[]): string | null {
	const types = new Map<string, { count: number; last: string }>();
	for (const item of history) {
		const t = types.get(item.fuelType) ?? { count: 0, last: '' };
		t.count += 1;
		if (item.date > t.last) t.last = item.date;
		types.set(item.fuelType, t);
	}
	let best: { type: string; count: number; last: string } | null = null;
	for (const [type, t] of types) {
		if (!best || t.count > best.count || (t.count === best.count && t.last > best.last)) {
			best = { type, ...t };
		}
	}
	return best?.type ?? null;
}

function weightedMean(items: PriceEntry[]): number {
	const byVolume = items.every(item => item.volume != null && item.volume > 0);
	let sum = 0;
	let weight = 0;
	for (const item of items) {
		const w = byVolume ? (item.volume as number) : 1;
		sum += item.pricePerVolume * w;
		weight += w;
	}
	return sum / weight;
}

export function priceSummary(history: PriceEntry[]): PriceSummary | null {
	const fuelType = mainFuelType(history);
	if (fuelType == null) return null;
	const fills = history.filter(item => item.fuelType === fuelType);
	const byMonth = new Map<string, PriceEntry[]>();
	for (const item of fills) byMonth.set(item.month, [...(byMonth.get(item.month) ?? []), item]);
	const monthly = [...byMonth].map(([month, items]) => ({ month, avg: weightedMean(items) }));
	const cheapest = monthly.reduce((a, b) => (b.avg < a.avg ? b : a));
	return {
		fuelType,
		average: weightedMean(fills),
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

export interface FillupRow {
	vehicleId: string;
	label: string;
	count: number;
	volume: number;
	avgPrice: number | null;
}

export function fillupRows(totals: FuelStatsResponse['fillupsByVehicle']): FillupRow[] {
	return (totals ?? []).map(t => ({
		vehicleId: t.vehicleId,
		label: t.vehicleName,
		count: t.count,
		volume: t.volume,
		avgPrice: t.volume > 0 && t.cost > 0 ? t.cost / t.volume : null
	}));
}

type ChargerEntry = NonNullable<FuelStatsResponse['charging']>['byChargerType'][number];

export interface ChargerRow {
	key: ChargerEntry['chargerType'];
	label: string;
	sessions: number;
	share: number;
	rate: number | null;
}

export function chargerRows(byType: ChargerEntry[] | undefined): ChargerRow[] {
	return (byType ?? [])
		.filter(t => t.sessions > 0)
		.map(t => ({
			key: t.chargerType,
			label: t.chargerType === 'unspecified' ? 'Not set' : CHARGER_TYPE_LABELS[t.chargerType],
			sessions: t.sessions,
			share: t.energyShare,
			rate: t.pricePerEnergyUnit
		}));
}

export interface HomeSplit {
	homeShare: number;
	homeRate: number | null;
	awayRate: number | null;
}

export function homeSplit(byType: ChargerEntry[] | undefined): HomeSplit | null {
	const rows = (byType ?? []).filter(t => t.sessions > 0);
	const home = rows.find(t => t.chargerType === 'home');
	if (!home || rows.length < 2) return null;
	const away = rows.filter(
		t => t.chargerType !== 'home' && t.chargerType !== 'unspecified' && t.pricePerEnergyUnit != null
	);
	const energy = away.reduce((s, t) => s + t.energy, 0);
	const awayRate =
		energy > 0
			? away.reduce((s, t) => s + (t.pricePerEnergyUnit as number) * t.energy, 0) / energy
			: null;
	return { homeShare: home.energyShare, homeRate: home.pricePerEnergyUnit, awayRate };
}
