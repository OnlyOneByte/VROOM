/**
 * Statistics and analytics types
 */

export interface VehicleStats {
	totalExpenses: number;
	recentExpenses: number;
	expenseCount: number;
	recentExpenseCount: number;
	avgMpg: number;
	currentMileage: number;
	costPerMile: number;
	trend: number;
	lastExpenseDate: Date | null;
	lastMaintenanceDate: Date | null;
	daysSinceLastMaintenance: number | null;
	maintenanceCount: number;
}

export interface DashboardStats {
	totalVehicles: number;
	activeLoans: number;
	totalRecentExpenses: number;
	totalExpenses: number;
	averageExpensePerVehicle: number;
}
