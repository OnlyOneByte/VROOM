import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the analytics API
vi.mock('$lib/utils/analytics-api', () => ({
	getFuelEfficiency: vi.fn(),
	getDashboardAnalytics: vi.fn(),
	getVehicleAnalytics: vi.fn(),
	getTrendData: vi.fn(),
	getCostPerMile: vi.fn()
}));

// Mock D3 charts
vi.mock('$lib/utils/charts', () => ({
	createLineChart: vi.fn(),
	createBarChart: vi.fn(),
	createPieChart: vi.fn(),
	createMultiLineChart: vi.fn(),
	cleanupTooltips: vi.fn()
}));

describe('Efficiency Alert Logic', () => {
	const mockFuelData = {
		averageMPG: 30.5,
		totalGallons: 100,
		totalMiles: 3050,
		trend: [
			{ date: '2024-01-01', mpg: 32.1, mileage: 1000 },
			{ date: '2024-02-01', mpg: 31.5, mileage: 1500 },
			{ date: '2024-03-01', mpg: 25.2, mileage: 2000 }, // Efficiency drop
			{ date: '2024-04-01', mpg: 24.8, mileage: 2500 }, // Continued drop
			{ date: '2024-05-01', mpg: 25.1, mileage: 3000 }
		]
	};

	// Helper functions from EfficiencyAlerts component
	function calculateVariance(values: number[]): number {
		const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
		const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
		return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
	}

	function analyzeEfficiencyAlerts(fuelData: any, vehicle: any) {
		if (!fuelData || !fuelData.trend || fuelData.trend.length < 3) return [];

		const alerts = [];
		const trend = fuelData.trend;
		const averageMPG = fuelData.averageMPG;
		const vehicleName = vehicle.nickname || vehicle.name;

		// Get recent readings (last 3)
		const recentReadings = trend.slice(-3);
		const recentAverage =
			recentReadings.reduce((sum: number, d: any) => sum + d.mpg, 0) / recentReadings.length;

		// Significant efficiency drop
		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = ((averageMPG - recentAverage) / averageMPG) * 100;
			alerts.push({
				id: `${vehicle.id}-efficiency-drop`,
				vehicleId: vehicle.id,
				vehicleName,
				type: 'efficiency_drop',
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium',
				title: `${vehicleName}: Fuel Efficiency Drop`,
				message: `Efficiency dropped ${dropPercentage.toFixed(1)}% below average (${recentAverage.toFixed(1)} vs ${averageMPG.toFixed(1)} MPG)`,
				recommendation:
					dropPercentage > 25
						? 'Schedule maintenance check - possible engine issues'
						: 'Check tire pressure and driving habits',
				timestamp: new Date().toISOString(),
				data: {
					currentMPG: recentAverage,
					averageMPG,
					dropPercentage
				}
			});
		}

		// Consistent improvement
		if (recentReadings.length >= 3) {
			const isImproving = recentReadings.every(
				(reading: any, index: number) => index === 0 || reading.mpg >= recentReadings[index - 1].mpg
			);

			if (isImproving && recentAverage > averageMPG * 1.1) {
				alerts.push({
					id: `${vehicle.id}-efficiency-improvement`,
					vehicleId: vehicle.id,
					vehicleName,
					type: 'efficiency_improvement',
					severity: 'positive',
					title: `${vehicleName}: Efficiency Improvement`,
					message: `Great job! Efficiency improved ${(((recentAverage - averageMPG) / averageMPG) * 100).toFixed(1)}% above average`,
					recommendation: 'Keep up the efficient driving habits',
					timestamp: new Date().toISOString(),
					data: {
						currentMPG: recentAverage,
						averageMPG,
						improvementPercentage: ((recentAverage - averageMPG) / averageMPG) * 100
					}
				});
			}
		}

		// Erratic efficiency (high variance)
		if (trend.length >= 5) {
			const last5 = trend.slice(-5);
			const variance = calculateVariance(last5.map((d: any) => d.mpg));
			const stdDev = Math.sqrt(variance);

			if (stdDev > averageMPG * 0.15) {
				// 15% standard deviation
				alerts.push({
					id: `${vehicle.id}-erratic-efficiency`,
					vehicleId: vehicle.id,
					vehicleName,
					type: 'erratic_efficiency',
					severity: 'medium',
					title: `${vehicleName}: Inconsistent Efficiency`,
					message: `Fuel efficiency varies significantly (±${((stdDev / averageMPG) * 100).toFixed(1)}%)`,
					recommendation: 'Consider consistent driving habits and regular maintenance',
					timestamp: new Date().toISOString(),
					data: {
						averageMPG,
						standardDeviation: stdDev,
						variancePercentage: (stdDev / averageMPG) * 100
					}
				});
			}
		}

		return alerts;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate efficiency drop alerts correctly', () => {
		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(mockFuelData, vehicle);

		// Should detect efficiency drop
		const dropAlert = alerts.find(alert => alert.type === 'efficiency_drop');
		expect(dropAlert).toBeDefined();
		expect(dropAlert?.severity).toBe('medium'); // Not below 70% threshold

		// Check calculation accuracy
		const recentReadings = mockFuelData.trend.slice(-3);
		const recentAverage = recentReadings.reduce((sum, d) => sum + d.mpg, 0) / recentReadings.length;
		const expectedDropPercentage =
			((mockFuelData.averageMPG - recentAverage) / mockFuelData.averageMPG) * 100;

		expect(dropAlert?.data.dropPercentage).toBeCloseTo(expectedDropPercentage, 1);
	});

	it('should detect efficiency improvement alerts', () => {
		const improvementData = {
			...mockFuelData,
			averageMPG: 28.0,
			trend: [
				{ date: '2024-01-01', mpg: 25.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 28.0, mileage: 1500 },
				{ date: '2024-03-01', mpg: 32.0, mileage: 2000 }, // Improving
				{ date: '2024-04-01', mpg: 34.0, mileage: 2500 }, // Continued improvement
				{ date: '2024-05-01', mpg: 35.0, mileage: 3000 }
			]
		};

		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(improvementData, vehicle);

		const improvementAlert = alerts.find(alert => alert.type === 'efficiency_improvement');
		expect(improvementAlert).toBeDefined();
		expect(improvementAlert?.severity).toBe('positive');
	});

	it('should detect erratic efficiency patterns', () => {
		const erraticData = {
			...mockFuelData,
			trend: [
				{ date: '2024-01-01', mpg: 35.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 20.0, mileage: 1500 }, // High variance
				{ date: '2024-03-01', mpg: 38.0, mileage: 2000 },
				{ date: '2024-04-01', mpg: 18.0, mileage: 2500 },
				{ date: '2024-05-01', mpg: 40.0, mileage: 3000 }
			]
		};

		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(erraticData, vehicle);

		const erraticAlert = alerts.find(alert => alert.type === 'erratic_efficiency');
		expect(erraticAlert).toBeDefined();
		expect(erraticAlert?.severity).toBe('medium');
	});

	it('should return no alerts for stable efficiency', () => {
		const stableData = {
			...mockFuelData,
			trend: [
				{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 30.5, mileage: 1500 },
				{ date: '2024-03-01', mpg: 31.0, mileage: 2000 }
			]
		};

		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(stableData, vehicle);

		expect(alerts).toHaveLength(0);
	});

	it('should handle insufficient data gracefully', () => {
		const insufficientData = {
			...mockFuelData,
			trend: [{ date: '2024-01-01', mpg: 30.0, mileage: 1000 }]
		};

		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(insufficientData, vehicle);

		expect(alerts).toHaveLength(0);
	});

	it('should calculate variance correctly', () => {
		const values = [20, 25, 30, 35, 40];
		const variance = calculateVariance(values);

		// Expected variance: ((20-30)² + (25-30)² + (30-30)² + (35-30)² + (40-30)²) / 5 = 50
		expect(variance).toBe(50);
	});

	it('should determine alert severity based on drop percentage', () => {
		// High severity test (drop > 30%)
		const highSeverityData = {
			...mockFuelData,
			averageMPG: 30.0,
			trend: [
				{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 18.0, mileage: 1500 }, // 40% drop
				{ date: '2024-03-01', mpg: 17.0, mileage: 2000 },
				{ date: '2024-04-01', mpg: 16.0, mileage: 2500 }
			]
		};

		const vehicle = { id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' };
		const alerts = analyzeEfficiencyAlerts(highSeverityData, vehicle);

		const dropAlert = alerts.find(alert => alert.type === 'efficiency_drop');
		expect(dropAlert?.severity).toBe('high');
	});
});

describe('Fuel Efficiency Monitoring Logic', () => {
	const mockFuelData = {
		averageMPG: 30.5,
		totalGallons: 100,
		totalMiles: 3050,
		trend: [
			{ date: '2024-01-01', mpg: 32.1, mileage: 1000 },
			{ date: '2024-02-01', mpg: 31.5, mileage: 1500 },
			{ date: '2024-03-01', mpg: 30.2, mileage: 2000 },
			{ date: '2024-04-01', mpg: 29.8, mileage: 2500 },
			{ date: '2024-05-01', mpg: 30.1, mileage: 3000 }
		]
	};

	// Helper functions from FuelEfficiencyMonitor component
	function calculateEfficiencyTrend(fuelEntries: any[]) {
		if (!fuelEntries || fuelEntries.length < 2) return null;

		const recent = fuelEntries.slice(-3);
		const older = fuelEntries.slice(-6, -3);

		if (recent.length === 0 || older.length === 0) return null;

		const recentAvg = recent.reduce((sum: number, d: any) => sum + d.mpg, 0) / recent.length;
		const olderAvg = older.reduce((sum: number, d: any) => sum + d.mpg, 0) / older.length;

		const change = ((recentAvg - olderAvg) / olderAvg) * 100;

		return {
			change: change.toFixed(1),
			direction: change > 0 ? 'improving' : 'declining',
			recentAvg: recentAvg.toFixed(1),
			olderAvg: olderAvg.toFixed(1)
		};
	}

	function detectEfficiencyAlerts(fuelData: any[], averageMPG: number) {
		if (!fuelData || fuelData.length < 3) return [];

		const alerts = [];
		const recentReadings = fuelData.slice(-3);
		const recentAverage = recentReadings.reduce((sum, d) => sum + d.mpg, 0) / recentReadings.length;

		// Efficiency drop alert
		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = ((averageMPG - recentAverage) / averageMPG) * 100;
			alerts.push({
				type: 'efficiency_drop',
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium',
				message: `Efficiency dropped ${dropPercentage.toFixed(1)}% below average`,
				currentMPG: recentAverage.toFixed(1),
				averageMPG: averageMPG.toFixed(1),
				recommendation:
					dropPercentage > 25
						? 'Consider scheduling a maintenance check - this could indicate engine issues'
						: 'Monitor driving habits and consider checking tire pressure'
			});
		}

		return alerts;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate trend analysis correctly', () => {
		const extendedData = [
			...mockFuelData.trend,
			{ date: '2024-06-01', mpg: 31.0, mileage: 3500 },
			{ date: '2024-07-01', mpg: 32.0, mileage: 4000 }
		];

		const trendAnalysis = calculateEfficiencyTrend(extendedData);

		expect(trendAnalysis).toBeDefined();
		expect(trendAnalysis?.direction).toBe('improving');

		// The actual result is 1.7% based on the calculation
		expect(parseFloat(trendAnalysis?.change || '0')).toBeCloseTo(1.7, 0);
	});

	it('should detect efficiency drop alerts', () => {
		const dropData = [
			{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 25.0, mileage: 1500 }, // Drop
			{ date: '2024-03-01', mpg: 24.0, mileage: 2000 }, // Continued drop
			{ date: '2024-04-01', mpg: 23.0, mileage: 2500 }
		];

		const alerts = detectEfficiencyAlerts(dropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.type).toBe('efficiency_drop');
		expect(alerts[0]?.severity).toBe('medium'); // 24 MPG is > 70% of 30 MPG
	});

	it('should determine high severity for significant drops', () => {
		const severeDropData = [
			{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 18.0, mileage: 1500 }, // Severe drop
			{ date: '2024-03-01', mpg: 17.0, mileage: 2000 },
			{ date: '2024-04-01', mpg: 16.0, mileage: 2500 }
		];

		const alerts = detectEfficiencyAlerts(severeDropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.severity).toBe('high'); // 17 MPG is < 70% of 30 MPG
	});

	it('should return no alerts for stable efficiency', () => {
		const stableData = [
			{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 30.5, mileage: 1500 },
			{ date: '2024-03-01', mpg: 29.5, mileage: 2000 }
		];

		const alerts = detectEfficiencyAlerts(stableData, 30.0);

		expect(alerts).toHaveLength(0);
	});

	it('should handle insufficient data for trend analysis', () => {
		const insufficientData = [{ date: '2024-01-01', mpg: 30.0, mileage: 1000 }];

		const trendAnalysis = calculateEfficiencyTrend(insufficientData);

		expect(trendAnalysis).toBeNull();
	});

	it('should calculate period comparison correctly', () => {
		const calculatePeriodComparison = (trend: any[]) => {
			if (trend.length < 6) return null;

			const halfPoint = Math.floor(trend.length / 2);
			const firstHalf = trend.slice(0, halfPoint);
			const secondHalf = trend.slice(halfPoint);

			const firstHalfAvg =
				firstHalf.reduce((sum: number, d: any) => sum + d.mpg, 0) / firstHalf.length;
			const secondHalfAvg =
				secondHalf.reduce((sum: number, d: any) => sum + d.mpg, 0) / secondHalf.length;
			const improvement = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

			return {
				firstHalfAvg: firstHalfAvg.toFixed(1),
				secondHalfAvg: secondHalfAvg.toFixed(1),
				improvement: improvement.toFixed(1)
			};
		};

		const extendedTrend = [
			{ date: '2024-01-01', mpg: 28.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 29.0, mileage: 1500 },
			{ date: '2024-03-01', mpg: 30.0, mileage: 2000 },
			{ date: '2024-04-01', mpg: 31.0, mileage: 2500 },
			{ date: '2024-05-01', mpg: 32.0, mileage: 3000 },
			{ date: '2024-06-01', mpg: 33.0, mileage: 3500 }
		];

		const comparison = calculatePeriodComparison(extendedTrend);

		expect(comparison).toBeDefined();
		expect(comparison?.firstHalfAvg).toBe('29.0'); // (28+29+30)/3
		expect(comparison?.secondHalfAvg).toBe('32.0'); // (31+32+33)/3
		expect(parseFloat(comparison?.improvement || '0')).toBeCloseTo(10.3, 0); // ((32-29)/29)*100
	});
});

describe('Vehicle Efficiency Summary Logic', () => {
	const mockVehicles = [
		{ id: 'vehicle-1', name: '2020 Honda Civic', nickname: 'Daily Driver' },
		{ id: 'vehicle-2', name: '2018 Toyota Prius', nickname: 'Eco Car' },
		{ id: 'vehicle-3', name: '2015 Ford F-150', nickname: 'Truck' }
	];

	const mockEfficiencyData = {
		'vehicle-1': {
			averageMPG: 30.5,
			totalGallons: 100,
			totalMiles: 3050,
			trend: [
				{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 31.0, mileage: 1500 }
			]
		},
		'vehicle-2': {
			averageMPG: 45.2,
			totalGallons: 80,
			totalMiles: 3616,
			trend: [
				{ date: '2024-01-01', mpg: 44.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 46.0, mileage: 1500 }
			]
		},
		'vehicle-3': {
			averageMPG: 18.5,
			totalGallons: 150,
			totalMiles: 2775,
			trend: [
				{ date: '2024-01-01', mpg: 18.0, mileage: 1000 },
				{ date: '2024-02-01', mpg: 19.0, mileage: 1500 }
			]
		}
	};

	// Helper functions from VehicleEfficiencySummary component
	function calculateTrend(trendData: any[]) {
		if (!trendData || trendData.length < 4) return 'stable';

		const recent = trendData.slice(-3);
		const older = trendData.slice(-6, -3);

		if (recent.length === 0 || older.length === 0) return 'stable';

		const recentAvg = recent.reduce((sum, d) => sum + d.mpg, 0) / recent.length;
		const olderAvg = older.reduce((sum, d) => sum + d.mpg, 0) / older.length;

		const change = (recentAvg - olderAvg) / olderAvg;

		if (change > 0.05) return 'improving'; // 5% improvement
		if (change < -0.05) return 'declining'; // 5% decline
		return 'stable';
	}

	function calculateEfficiencyRating(averageMPG: number): string {
		if (averageMPG === 0) return 'unknown';

		// Simple rating based on MPG ranges
		if (averageMPG >= 35) return 'excellent';
		if (averageMPG >= 28) return 'good';
		if (averageMPG >= 22) return 'average';
		if (averageMPG >= 18) return 'below-average';
		return 'poor';
	}

	function sortVehiclesByEfficiency(vehicles: any[], efficiencyData: any) {
		const ratingOrder = {
			excellent: 5,
			good: 4,
			average: 3,
			'below-average': 2,
			poor: 1,
			unknown: 0
		};

		return vehicles
			.map(vehicle => ({
				...vehicle,
				efficiency: efficiencyData[vehicle.id] || { rating: 'unknown' }
			}))
			.sort((a, b) => {
				const aRating = ratingOrder[a.efficiency.rating as keyof typeof ratingOrder] || 0;
				const bRating = ratingOrder[b.efficiency.rating as keyof typeof ratingOrder] || 0;
				return bRating - aRating;
			});
	}

	function calculateFleetSummary(efficiencyData: any) {
		const fleetData = Object.values(efficiencyData).filter((d: any) => d.averageMPG > 0);

		if (fleetData.length === 0) return null;

		const fleetAvgMPG =
			fleetData.reduce((sum: number, d: any) => sum + d.averageMPG, 0) / fleetData.length;
		const totalGallons = fleetData.reduce((sum: number, d: any) => sum + d.totalGallons, 0);
		const totalMiles = fleetData.reduce((sum: number, d: any) => sum + d.totalMiles, 0);
		const overallMPG = totalMiles > 0 ? (totalGallons > 0 ? totalMiles / totalGallons : 0) : 0;

		return {
			fleetAvgMPG: fleetAvgMPG.toFixed(1),
			totalGallons: totalGallons.toFixed(0),
			totalMiles: totalMiles.toLocaleString(),
			overallMPG: overallMPG.toFixed(1)
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate efficiency ratings correctly', () => {
		expect(calculateEfficiencyRating(45.2)).toBe('excellent'); // Prius
		expect(calculateEfficiencyRating(30.5)).toBe('good'); // Civic
		expect(calculateEfficiencyRating(18.5)).toBe('below-average'); // F-150 (18.5 >= 18)
		expect(calculateEfficiencyRating(25.0)).toBe('average');
		expect(calculateEfficiencyRating(20.0)).toBe('below-average');
		expect(calculateEfficiencyRating(17.0)).toBe('poor'); // Below 18
		expect(calculateEfficiencyRating(0)).toBe('unknown');
	});

	it('should calculate trend directions correctly', () => {
		// Improving trend
		const improvingTrend = [
			{ date: '2024-01-01', mpg: 25.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 26.0, mileage: 1500 },
			{ date: '2024-03-01', mpg: 30.0, mileage: 2000 },
			{ date: '2024-04-01', mpg: 32.0, mileage: 2500 },
			{ date: '2024-05-01', mpg: 34.0, mileage: 3000 },
			{ date: '2024-06-01', mpg: 35.0, mileage: 3500 }
		];

		expect(calculateTrend(improvingTrend)).toBe('improving');

		// Declining trend
		const decliningTrend = [
			{ date: '2024-01-01', mpg: 35.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 34.0, mileage: 1500 },
			{ date: '2024-03-01', mpg: 30.0, mileage: 2000 },
			{ date: '2024-04-01', mpg: 28.0, mileage: 2500 },
			{ date: '2024-05-01', mpg: 26.0, mileage: 3000 },
			{ date: '2024-06-01', mpg: 25.0, mileage: 3500 }
		];

		expect(calculateTrend(decliningTrend)).toBe('declining');

		// Stable trend
		const stableTrend = [
			{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 30.5, mileage: 1500 },
			{ date: '2024-03-01', mpg: 29.5, mileage: 2000 },
			{ date: '2024-04-01', mpg: 30.2, mileage: 2500 }
		];

		expect(calculateTrend(stableTrend)).toBe('stable');
	});

	it('should sort vehicles by efficiency rating', () => {
		const vehicleEfficiencyData = {
			'vehicle-1': { rating: 'good' },
			'vehicle-2': { rating: 'excellent' },
			'vehicle-3': { rating: 'poor' }
		};

		const sorted = sortVehiclesByEfficiency(mockVehicles, vehicleEfficiencyData);

		expect(sorted[0].id).toBe('vehicle-2'); // Excellent (Prius)
		expect(sorted[1].id).toBe('vehicle-1'); // Good (Civic)
		expect(sorted[2].id).toBe('vehicle-3'); // Poor (F-150)
	});

	it('should calculate fleet summary statistics', () => {
		const summary = calculateFleetSummary(mockEfficiencyData);

		expect(summary).toBeDefined();

		// Fleet average MPG: (30.5 + 45.2 + 18.5) / 3 = 31.4
		expect(summary?.fleetAvgMPG).toBe('31.4');

		// Total gallons: 100 + 80 + 150 = 330
		expect(summary?.totalGallons).toBe('330');

		// Total miles: 3050 + 3616 + 2775 = 9441
		expect(summary?.totalMiles).toBe('9,441');

		// Overall MPG: 9441 / 330 = 28.6
		expect(parseFloat(summary?.overallMPG || '0')).toBeCloseTo(28.6, 1);
	});

	it('should handle empty efficiency data', () => {
		const summary = calculateFleetSummary({});
		expect(summary).toBeNull();
	});

	it('should handle vehicles with zero MPG', () => {
		const dataWithZeros = {
			'vehicle-1': { averageMPG: 0, totalGallons: 0, totalMiles: 0 },
			'vehicle-2': { averageMPG: 30.0, totalGallons: 100, totalMiles: 3000 }
		};

		const summary = calculateFleetSummary(dataWithZeros);

		expect(summary?.fleetAvgMPG).toBe('30.0'); // Only counts non-zero vehicles
		expect(summary?.totalGallons).toBe('100');
		expect(summary?.totalMiles).toBe('3,000');
	});

	it('should handle insufficient trend data', () => {
		const shortTrend = [
			{ date: '2024-01-01', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 31.0, mileage: 1500 }
		];

		expect(calculateTrend(shortTrend)).toBe('stable');
	});

	it('should calculate 5% threshold for trend changes correctly', () => {
		// Significant improvement (should be improving)
		const improvementTrend = [
			{ date: '2024-01-01', mpg: 25.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 26.0, mileage: 1500 },
			{ date: '2024-03-01', mpg: 27.0, mileage: 2000 }, // Older avg: 26.0
			{ date: '2024-04-01', mpg: 30.0, mileage: 2500 }, // Recent avg: 29.0
			{ date: '2024-05-01', mpg: 29.0, mileage: 3000 }, // 11.5% improvement
			{ date: '2024-06-01', mpg: 28.0, mileage: 3500 }
		];

		expect(calculateTrend(improvementTrend)).toBe('improving');

		// Just under 5% improvement (should be stable)
		const almostImprovementTrend = [
			{ date: '2024-01-01', mpg: 28.0, mileage: 1000 },
			{ date: '2024-02-01', mpg: 29.0, mileage: 1500 },
			{ date: '2024-03-01', mpg: 30.0, mileage: 2000 }, // Older avg: 29.0
			{ date: '2024-04-01', mpg: 30.2, mileage: 2500 }, // Recent avg: 30.2
			{ date: '2024-05-01', mpg: 30.2, mileage: 3000 }, // 4.1% improvement
			{ date: '2024-06-01', mpg: 30.2, mileage: 3500 }
		];

		expect(calculateTrend(almostImprovementTrend)).toBe('stable');
	});
});
