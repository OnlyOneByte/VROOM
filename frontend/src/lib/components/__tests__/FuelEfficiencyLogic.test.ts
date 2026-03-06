import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Fuel Efficiency Calculation Logic', () => {
	// Core calculation functions
	function calculateMPG(miles: number, gallons: number): number {
		if (gallons <= 0) return 0;
		return miles / gallons;
	}

	function calculateFuelCost(gallons: number, pricePerGallon: number): number {
		return gallons * pricePerGallon;
	}

	function calculateCostPerMile(totalCost: number, totalMiles: number): number {
		if (totalMiles <= 0) return 0;
		return totalCost / totalMiles;
	}

	function calculateEfficiencyTrend(fuelEntries: any[]): string {
		if (!fuelEntries || fuelEntries.length < 2) return 'insufficient-data';

		const recent = fuelEntries.slice(-3);
		const older = fuelEntries.slice(-6, -3);

		if (recent.length === 0 || older.length === 0) return 'insufficient-data';

		const recentAvg = recent.reduce((sum, entry) => sum + entry.mpg, 0) / recent.length;
		const olderAvg = older.reduce((sum, entry) => sum + entry.mpg, 0) / older.length;

		const change = (recentAvg - olderAvg) / olderAvg;

		if (change > 0.05) return 'improving'; // 5% improvement
		if (change < -0.05) return 'declining'; // 5% decline
		return 'stable';
	}

	function calculateEfficiencyVariance(mpgValues: number[]): number {
		if (mpgValues.length < 2) return 0;

		const mean = mpgValues.reduce((sum, val) => sum + val, 0) / mpgValues.length;
		const squaredDiffs = mpgValues.map(val => Math.pow(val - mean, 2));
		return squaredDiffs.reduce((sum, val) => sum + val, 0) / mpgValues.length;
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
				dropPercentage: dropPercentage.toFixed(1)
			});
		}

		// Efficiency improvement alert
		if (recentReadings.length >= 3) {
			const isImproving = recentReadings.every(
				(reading, index) => index === 0 || reading.mpg >= recentReadings[index - 1].mpg
			);

			if (isImproving && recentAverage > averageMPG * 1.1) {
				alerts.push({
					type: 'efficiency_improvement',
					severity: 'positive',
					message: `Efficiency improved by ${(((recentAverage - averageMPG) / averageMPG) * 100).toFixed(1)}%`,
					currentMPG: recentAverage.toFixed(1),
					averageMPG: averageMPG.toFixed(1)
				});
			}
		}

		// Erratic efficiency alert
		if (fuelData.length >= 5) {
			const last5 = fuelData.slice(-5);
			const variance = calculateEfficiencyVariance(last5.map(d => d.mpg));
			const stdDev = Math.sqrt(variance);

			if (stdDev > averageMPG * 0.15) {
				// 15% standard deviation
				alerts.push({
					type: 'erratic_efficiency',
					severity: 'medium',
					message: `Fuel efficiency varies significantly (±${((stdDev / averageMPG) * 100).toFixed(1)}%)`,
					standardDeviation: stdDev.toFixed(1),
					variancePercentage: ((stdDev / averageMPG) * 100).toFixed(1)
				});
			}
		}

		return alerts;
	}

	function calculateFuelEfficiencyMetrics(fuelEntries: any[]) {
		if (fuelEntries.length === 0) return null;

		const totalGallons = fuelEntries.reduce((sum, entry) => sum + (entry.gallons || 0), 0);
		const totalCost = fuelEntries.reduce((sum, entry) => sum + (entry.cost || 0), 0);
		const totalMiles =
			fuelEntries.length > 1
				? Math.max(...fuelEntries.map(e => e.mileage)) -
					Math.min(...fuelEntries.map(e => e.mileage))
				: 0;

		const averageMPG = totalGallons > 0 ? totalMiles / totalGallons : 0;
		const averageCostPerGallon = totalGallons > 0 ? totalCost / totalGallons : 0;
		const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

		return {
			totalGallons: totalGallons.toFixed(1),
			totalCost: totalCost.toFixed(2),
			totalMiles: totalMiles.toLocaleString(),
			averageMPG: averageMPG.toFixed(1),
			averageCostPerGallon: averageCostPerGallon.toFixed(3),
			costPerMile: costPerMile.toFixed(3)
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate MPG correctly', () => {
		expect(calculateMPG(300, 10)).toBe(30.0);
		expect(calculateMPG(450, 15)).toBe(30.0);
		expect(calculateMPG(0, 10)).toBe(0);
		expect(calculateMPG(300, 0)).toBe(0);
	});

	it('should calculate fuel cost correctly', () => {
		expect(calculateFuelCost(10, 3.5)).toBe(35.0);
		expect(calculateFuelCost(12.5, 3.759)).toBeCloseTo(46.99, 2);
		expect(calculateFuelCost(0, 3.5)).toBe(0);
	});

	it('should calculate cost per mile correctly', () => {
		expect(calculateCostPerMile(35.0, 300)).toBeCloseTo(0.117, 3);
		expect(calculateCostPerMile(50.0, 400)).toBe(0.125);
		expect(calculateCostPerMile(35.0, 0)).toBe(0);
		expect(calculateCostPerMile(0, 300)).toBe(0);
	});

	it('should handle decimal inputs correctly', () => {
		expect(calculateMPG(287.5, 9.25)).toBeCloseTo(31.081, 2);
		expect(calculateFuelCost(9.25, 3.759)).toBeCloseTo(34.771, 2);
		expect(calculateCostPerMile(34.771, 287.5)).toBeCloseTo(0.121, 3);
	});

	it('should calculate efficiency trend correctly', () => {
		// Improving trend
		const improvingData = [
			{ mpg: 25.0 },
			{ mpg: 26.0 },
			{ mpg: 27.0 }, // Older: avg 26.0
			{ mpg: 30.0 },
			{ mpg: 31.0 },
			{ mpg: 32.0 } // Recent: avg 31.0, 19.2% improvement
		];
		expect(calculateEfficiencyTrend(improvingData)).toBe('improving');

		// Declining trend
		const decliningData = [
			{ mpg: 35.0 },
			{ mpg: 34.0 },
			{ mpg: 33.0 }, // Older: avg 34.0
			{ mpg: 30.0 },
			{ mpg: 29.0 },
			{ mpg: 28.0 } // Recent: avg 29.0, 14.7% decline
		];
		expect(calculateEfficiencyTrend(decliningData)).toBe('declining');

		// Stable trend
		const stableData = [
			{ mpg: 30.0 },
			{ mpg: 30.5 },
			{ mpg: 29.5 }, // Older: avg 30.0
			{ mpg: 30.2 },
			{ mpg: 29.8 },
			{ mpg: 30.0 } // Recent: avg 30.0, 0% change
		];
		expect(calculateEfficiencyTrend(stableData)).toBe('stable');
	});

	it('should calculate efficiency variance correctly', () => {
		const values = [20, 25, 30, 35, 40];
		const variance = calculateEfficiencyVariance(values);

		// Expected variance: ((20-30)² + (25-30)² + (30-30)² + (35-30)² + (40-30)²) / 5 = 50
		expect(variance).toBe(50);

		// Test with identical values (should be 0 variance)
		const identicalValues = [30, 30, 30, 30];
		expect(calculateEfficiencyVariance(identicalValues)).toBe(0);

		// Test with single value
		expect(calculateEfficiencyVariance([30])).toBe(0);

		// Test with empty array
		expect(calculateEfficiencyVariance([])).toBe(0);
	});

	it('should detect efficiency drop alerts', () => {
		const dropData = [
			{ mpg: 30.0 },
			{ mpg: 25.0 },
			{ mpg: 24.0 },
			{ mpg: 23.0 } // Recent avg: 24.0
		];

		const alerts = detectEfficiencyAlerts(dropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.type).toBe('efficiency_drop');
		expect(alerts[0]?.severity).toBe('medium'); // 24.0 is 80% of 30.0 (above 70% threshold)
		expect(alerts[0]?.dropPercentage).toBe('20.0'); // ((30-24)/30)*100 = 20%
	});

	it('should detect high severity efficiency drops', () => {
		const severeDropData = [
			{ mpg: 30.0 },
			{ mpg: 18.0 },
			{ mpg: 17.0 },
			{ mpg: 16.0 } // Recent avg: 17.0
		];

		const alerts = detectEfficiencyAlerts(severeDropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.severity).toBe('high'); // 17.0 is 56.7% of 30.0 (below 70% threshold)
	});

	it('should detect efficiency improvement alerts', () => {
		const improvementData = [
			{ mpg: 32.0 },
			{ mpg: 33.0 },
			{ mpg: 34.0 } // Recent avg: 33.0, improving sequence
		];

		const alerts = detectEfficiencyAlerts(improvementData, 28.0); // 33.0 is 117.9% of 28.0

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.type).toBe('efficiency_improvement');
		expect(alerts[0]?.severity).toBe('positive');
	});

	it('should detect erratic efficiency patterns', () => {
		const erraticData = [{ mpg: 35.0 }, { mpg: 20.0 }, { mpg: 38.0 }, { mpg: 18.0 }, { mpg: 40.0 }];

		const alerts = detectEfficiencyAlerts(erraticData, 30.0);

		const erraticAlert = alerts.find(alert => alert.type === 'erratic_efficiency');
		expect(erraticAlert).toBeDefined();
		expect(erraticAlert?.severity).toBe('medium');
	});

	it('should calculate comprehensive fuel metrics', () => {
		const fuelEntries = [
			{ gallons: 12.0, cost: 42.0, mileage: 1000 },
			{ gallons: 11.5, cost: 40.25, mileage: 1350 },
			{ gallons: 13.2, cost: 46.2, mileage: 1750 }
		];

		const metrics = calculateFuelEfficiencyMetrics(fuelEntries);

		expect(metrics).toBeDefined();
		expect(metrics?.totalGallons).toBe('36.7'); // 12.0 + 11.5 + 13.2
		expect(metrics?.totalCost).toBe('128.45'); // 42.00 + 40.25 + 46.20
		expect(metrics?.totalMiles).toBe('750'); // 1750 - 1000
		expect(parseFloat(metrics?.averageMPG || '0')).toBeCloseTo(20.4, 1); // 750 / 36.7
		expect(parseFloat(metrics?.averageCostPerGallon || '0')).toBeCloseTo(3.5, 2); // 128.45 / 36.7
		expect(parseFloat(metrics?.costPerMile || '0')).toBeCloseTo(0.171, 3); // 128.45 / 750
	});

	it('should handle edge cases in calculations', () => {
		// Zero gallons
		expect(calculateMPG(300, 0)).toBe(0);

		// Zero miles
		expect(calculateMPG(0, 10)).toBe(0);
		expect(calculateCostPerMile(50, 0)).toBe(0);

		// Negative values (should still work mathematically)
		expect(calculateFuelCost(10, -3.5)).toBe(-35.0);
	});

	it('should handle insufficient data for trend analysis', () => {
		expect(calculateEfficiencyTrend([])).toBe('insufficient-data');
		expect(calculateEfficiencyTrend([{ mpg: 30.0 }])).toBe('insufficient-data');

		// Not enough for older comparison
		const shortData = [{ mpg: 30.0 }, { mpg: 31.0 }, { mpg: 32.0 }];
		expect(calculateEfficiencyTrend(shortData)).toBe('insufficient-data');
	});

	it('should calculate 5% threshold for trend changes accurately', () => {
		// Exactly 5% improvement
		const exactImprovement = [
			{ mpg: 28.0 },
			{ mpg: 29.0 },
			{ mpg: 30.0 }, // Older avg: 29.0
			{ mpg: 30.46 },
			{ mpg: 30.46 },
			{ mpg: 30.46 } // Recent avg: 30.46, 5.03% improvement
		];
		expect(calculateEfficiencyTrend(exactImprovement)).toBe('improving');

		// Just under 5% improvement
		const almostImprovement = [
			{ mpg: 28.0 },
			{ mpg: 29.0 },
			{ mpg: 30.0 }, // Older avg: 29.0
			{ mpg: 30.4 },
			{ mpg: 30.4 },
			{ mpg: 30.4 } // Recent avg: 30.4, 4.8% improvement
		];
		expect(calculateEfficiencyTrend(almostImprovement)).toBe('stable');

		// Exactly 5% decline
		const exactDecline = [
			{ mpg: 30.0 },
			{ mpg: 31.0 },
			{ mpg: 32.0 }, // Older avg: 31.0
			{ mpg: 29.45 },
			{ mpg: 29.45 },
			{ mpg: 29.45 } // Recent avg: 29.45, 5% decline
		];
		expect(calculateEfficiencyTrend(exactDecline)).toBe('declining');
	});

	it('should format numbers with appropriate precision', () => {
		const metrics = calculateFuelEfficiencyMetrics([
			{ gallons: 12.345, cost: 43.21, mileage: 1000 },
			{ gallons: 11.678, cost: 40.89, mileage: 1350 }
		]);

		// Should format to appropriate decimal places
		expect(metrics?.totalGallons).toMatch(/^\d+\.\d$/); // 1 decimal place
		expect(metrics?.totalCost).toMatch(/^\d+\.\d{2}$/); // 2 decimal places
		expect(metrics?.averageCostPerGallon).toMatch(/^\d+\.\d{3}$/); // 3 decimal places
		expect(metrics?.costPerMile).toMatch(/^\d+\.\d{3}$/); // 3 decimal places
	});

	it('should handle real-world fuel entry scenarios', () => {
		// Scenario: Road trip with varying efficiency
		const roadTripData = [
			{ gallons: 14.2, cost: 49.7, mileage: 45000 }, // City driving
			{ gallons: 12.8, cost: 44.8, mileage: 45420 }, // Highway driving
			{ gallons: 15.1, cost: 52.85, mileage: 45850 } // Mixed driving
		];

		const metrics = calculateFuelEfficiencyMetrics(roadTripData);

		expect(metrics).toBeDefined();
		expect(parseFloat(metrics?.totalMiles || '0')).toBe(850); // 45850 - 45000
		expect(parseFloat(metrics?.totalGallons || '0')).toBeCloseTo(42.1, 1);
		expect(parseFloat(metrics?.averageMPG || '0')).toBeCloseTo(20.2, 1); // 850 / 42.1
	});

	it('should detect multiple alert types simultaneously', () => {
		// Data that should trigger both erratic and drop alerts
		const complexData = [
			{ mpg: 35.0 },
			{ mpg: 20.0 },
			{ mpg: 38.0 }, // High variance
			{ mpg: 18.0 },
			{ mpg: 17.0 },
			{ mpg: 16.0 } // Recent drop
		];

		const alerts = detectEfficiencyAlerts(complexData, 30.0);

		expect(alerts.length).toBeGreaterThan(1);
		expect(alerts.some(alert => alert.type === 'efficiency_drop')).toBe(true);
		expect(alerts.some(alert => alert.type === 'erratic_efficiency')).toBe(true);
	});

	it('should calculate standard deviation correctly for erratic patterns', () => {
		const highVarianceValues = [10, 20, 30, 40, 50];
		const variance = calculateEfficiencyVariance(highVarianceValues);
		const stdDev = Math.sqrt(variance);

		// Standard deviation should be approximately 14.14
		expect(stdDev).toBeCloseTo(14.14, 1);

		// For average of 30, this is 47.1% variance (well above 15% threshold)
		const variancePercentage = (stdDev / 30) * 100;
		expect(variancePercentage).toBeGreaterThan(15);
	});

	it('should handle empty fuel entries gracefully', () => {
		const metrics = calculateFuelEfficiencyMetrics([]);

		expect(metrics).toBeNull();
	});

	it('should handle single fuel entry', () => {
		const singleEntry = [{ gallons: 12.0, cost: 42.0, mileage: 1000 }];

		const metrics = calculateFuelEfficiencyMetrics(singleEntry);

		expect(metrics).toBeDefined();
		expect(metrics?.totalMiles).toBe('0'); // Can't calculate miles with single entry
		expect(metrics?.averageMPG).toBe('0.0'); // No miles to calculate
	});

	it('should calculate improvement percentage correctly', () => {
		const improvementData = [
			{ mpg: 32.0 },
			{ mpg: 33.0 },
			{ mpg: 34.0 } // Recent avg: 33.0
		];

		const alerts = detectEfficiencyAlerts(improvementData, 28.0); // 33.0 vs 28.0
		const improvementAlert = alerts.find(alert => alert.type === 'efficiency_improvement');

		expect(improvementAlert).toBeDefined();
		// Improvement: ((33.0 - 28.0) / 28.0) * 100 = 17.9%
		expect(improvementAlert?.message).toContain('17.9%');
	});

	it('should validate alert trigger thresholds', () => {
		// Test 85% threshold for drop alerts
		const borderlineData = [
			{ mpg: 30.0 },
			{ mpg: 25.5 },
			{ mpg: 25.5 } // Recent avg: 25.5 (85% of 30.0)
		];

		const alerts = detectEfficiencyAlerts(borderlineData, 30.0);
		expect(alerts).toHaveLength(0); // Should not trigger at exactly 85%

		// Test just below 85% threshold
		const justBelowData = [
			{ mpg: 30.0 },
			{ mpg: 25.4 },
			{ mpg: 25.4 },
			{ mpg: 25.4 } // Recent avg: 25.4 (84.7% of 30.0)
		];

		const alertsBelow = detectEfficiencyAlerts(justBelowData, 30.0);
		expect(alertsBelow).toHaveLength(1);
	});
});
