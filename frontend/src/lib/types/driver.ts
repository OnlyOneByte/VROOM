export interface Driver {
	id: string;
	userId: string | null;
	name: string;
	color: string | null;
	archived: boolean;
}

export interface DriverFigures {
	driverId: string;
	name: string;
	color: string | null;
	archived: boolean;
	you: boolean;
	distance: { trips: number; estimated: number; total: number };
	share: number | null;
	fuelBought: number;
	fuelUsed: number | null;
	chargeBought: number;
	chargeUsed: number | null;
	runningCostsPaid: number;
}

export interface DriverStats {
	scope: 'everyone' | 'own';
	estimates: boolean;
	distance: { total: number; attributed: number; unattributed: number } | null;
	runningCosts: number | null;
	costPerDistance: number | null;
	drivers: DriverFigures[];
}

export type BackfillRequest =
	{ mode: 'logged' } | { mode: 'range'; driverId: string; from: string; to: string };

export interface BackfillSummary {
	total: number;
	trips: number;
	readings: number;
	expenses: number;
	byDriver: { driverId: string; name: string; count: number }[];
}

export interface BackfillBatch {
	id: string;
	mode: 'logged' | 'range';
	createdAt: string;
	total: number;
}
