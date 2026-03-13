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
	createdAt: string;
	updatedAt: string;
}

export interface VehicleFinancing {
	id: string;
	vehicleId: string;
	financingType: 'loan' | 'lease' | 'own';
	provider: string;
	originalAmount: number;
	currentBalance: number;
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
	createdAt: string;
	updatedAt: string;
}

export interface VehicleStats {
	period: '7d' | '30d' | '90d' | '1y' | 'all';
	totalMileage: number;
	currentMileage: number | null;
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
