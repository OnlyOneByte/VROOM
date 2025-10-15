import { authStore } from '$lib/stores/auth';
import { get } from 'svelte/store';

const API_BASE = import.meta.env['VITE_API_BASE_URL'] || '/api';

interface ApiResponse<T> {
	success: boolean;
	data: T;
	message?: string;
}

export interface DashboardData {
	vehicles: Array<{
		id: string;
		name: string;
		nickname?: string;
	}>;
	totalExpenses: number;
	monthlyTrends: Array<{
		period: string;
		amount: number;
	}>;
	categoryBreakdown: {
		[category: string]: {
			amount: number;
			count: number;
			percentage: number;
		};
	};
	fuelEfficiency: {
		averageMPG: number;
		totalGallons: number;
		totalFuelCost: number;
		averageCostPerGallon: number;
	};
	costPerMile: {
		totalCostPerMile: number;
		totalCost: number;
		totalMiles: number;
	};
}

export interface VehicleAnalytics {
	vehicle: {
		id: string;
		name: string;
		nickname?: string;
	};
	totalExpenses: number;
	monthlyTrends: Array<{
		period: string;
		amount: number;
	}>;
	categoryBreakdown: {
		[category: string]: {
			amount: number;
			count: number;
			percentage: number;
		};
	};
	fuelEfficiency: {
		averageMPG: number;
		totalGallons: number;
		totalMiles: number;
		trend: Array<{
			date: string;
			mpg: number;
			mileage: number;
		}>;
	};
	costPerMile: {
		costPerMile: number;
		totalCost: number;
		totalMiles: number;
	};
}

export interface TrendData {
	costTrends: Array<{
		period: string;
		amount: number;
	}>;
	milesTrends: Array<{
		period: string;
		miles: number;
	}>;
	costPerMileTrends: Array<{
		period: string;
		costPerMile: number;
	}>;
}

async function makeAuthenticatedRequest<T>(url: string): Promise<T> {
	const authState = get(authStore);

	if (!authState.isAuthenticated || !authState.token) {
		throw new Error('Not authenticated');
	}

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${authState.token}`,
			'Content-Type': 'application/json'
		},
		credentials: 'include'
	});

	if (!response.ok) {
		if (response.status === 401) {
			// Token might be expired, try to refresh
			await authStore.refreshToken();
			throw new Error('Authentication expired, please try again');
		}
		throw new Error(`API request failed: ${response.statusText}`);
	}

	const result: ApiResponse<T> = await response.json();

	if (!result.success) {
		throw new Error(result.message || 'API request failed');
	}

	return result.data;
}

export async function getDashboardAnalytics(
	startDate?: string,
	endDate?: string,
	groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<DashboardData> {
	const params = new URLSearchParams();
	if (startDate) params.append('startDate', startDate);
	if (endDate) params.append('endDate', endDate);
	params.append('groupBy', groupBy);

	const url = `${API_BASE}/analytics/dashboard?${params.toString()}`;
	return makeAuthenticatedRequest<DashboardData>(url);
}

export async function getVehicleAnalytics(
	vehicleId: string,
	startDate?: string,
	endDate?: string,
	groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<VehicleAnalytics> {
	const params = new URLSearchParams();
	if (startDate) params.append('startDate', startDate);
	if (endDate) params.append('endDate', endDate);
	params.append('groupBy', groupBy);

	const url = `${API_BASE}/analytics/vehicle/${vehicleId}?${params.toString()}`;
	return makeAuthenticatedRequest<VehicleAnalytics>(url);
}

export async function getTrendData(
	startDate?: string,
	endDate?: string,
	groupBy: 'day' | 'week' | 'month' | 'year' = 'month'
): Promise<TrendData> {
	const params = new URLSearchParams();
	if (startDate) params.append('startDate', startDate);
	if (endDate) params.append('endDate', endDate);
	params.append('groupBy', groupBy);

	const url = `${API_BASE}/analytics/trends?${params.toString()}`;
	return makeAuthenticatedRequest<TrendData>(url);
}

export async function getFuelEfficiency(vehicleId: string) {
	const url = `${API_BASE}/expenses/vehicles/${vehicleId}/fuel-efficiency`;
	return makeAuthenticatedRequest(url);
}

export async function getCostPerMile(vehicleId: string) {
	const url = `${API_BASE}/expenses/vehicles/${vehicleId}/cost-per-mile`;
	return makeAuthenticatedRequest(url);
}
