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
	/** Only on vehicles shared with the current user; owned vehicles have none. */
	sharedAccess?: SharedAccess;
	createdAt: string;
	updatedAt: string;
}

/** Nullable optional fields accept null to clear them; undefined leaves them unchanged. */
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
	/** Fuel-only max within the period; can drop in a short window and ignores manual odometer entries. */
	currentMileage: number | null;
	/** All-time odometer across expenses and manual entries; not affected by the period. */
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
