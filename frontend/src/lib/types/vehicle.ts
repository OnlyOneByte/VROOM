import type { SharedAccess } from './share.js';
import type { UnitPreferences } from './settings.js';

export type VehicleType = 'gas' | 'electric' | 'hybrid';

export interface Vehicle {
	id: string;
	userId?: string;
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	trackFuel: boolean;
	trackCharging: boolean;
	licensePlate?: string;
	nickname?: string;
	vin?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
	financing?: VehicleFinancing;
	unitPreferences?: UnitPreferences;
	/**
	 * Present ONLY on a vehicle owned by someone else and shared with the current user, when fetched
	 * via `getVehicles({ includeShared: true })` (T5a `?include=shared`). Carries the access level +
	 * who shared it; an owned vehicle has no `sharedAccess`. Lets the fleet card badge "shared by X"
	 * and gate edit affordances by level (T12b).
	 */
	sharedAccess?: SharedAccess;
	createdAt: string;
	updatedAt: string;
}

/**
 * Update payload for a vehicle. Unlike the read-model `Vehicle`, the nullable
 * optional fields accept `null` to CLEAR them on edit (vs `undefined`/absent =
 * leave unchanged). The backend `updateVehicleSchema` accepts nullish for these.
 */
export interface UpdateVehicleRequest {
	make?: string;
	model?: string;
	year?: number;
	vehicleType?: VehicleType;
	trackFuel?: boolean;
	trackCharging?: boolean;
	licensePlate?: string | null;
	nickname?: string | null;
	vin?: string | null;
	initialMileage?: number | null;
	purchasePrice?: number | null;
	purchaseDate?: string | null;
	unitPreferences?: UnitPreferences;
}

export interface VehicleFinancing {
	id: string;
	vehicleId: string;
	financingType: 'loan' | 'lease' | 'own';
	provider: string;
	originalAmount: number;
	apr?: number;
	termMonths: number;
	startDate: string;
	paymentAmount: number;
	paymentFrequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
	paymentDayOfMonth?: number;
	paymentDayOfWeek?: number;
	residualValue?: number;
	mileageLimit?: number;
	excessMileageFee?: number;
	isActive: boolean;
	endDate?: string;
	computedBalance?: number;
	eligibleForPayoff?: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface VehicleStats {
	period: '7d' | '30d' | '90d' | '1y' | 'all';
	totalMileage: number;
	/** Period-filtered + fuel-only MAX (can drop under a short window; ignores manual odometer entries). */
	currentMileage: number | null;
	/** Canonical all-time, all-sources odometer (expenses + manual entries); period-independent. */
	currentOdometer: number | null;
	totalFuelConsumed: number;
	totalChargeConsumed: number;
	averageMpg: number | null;
	averageMilesPerKwh: number | null;
	totalFuelCost: number;
	totalChargeCost: number;
	costPerMile: number | null;
	fuelExpenseCount: number;
	chargeExpenseCount: number;
}
