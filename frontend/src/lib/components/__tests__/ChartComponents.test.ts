import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the charts utility functions
vi.mock('$lib/utils/charts', () => ({
	createBarChart: vi.fn(),
	createPieChart: vi.fn(),
	createLineChart: vi.fn(),
	createMultiLineChart: vi.fn(),
	cleanupTooltips: vi.fn()
}));

describe('Category Breakdown Chart Logic', () => {
	const mockCategoryData = {
		operating: { amount: 1500.5, count: 25, percentage: 45.2 },
		maintenance: { amount: 800.25, count: 12, percentage: 24.1 },
		financial: { amount: 650.0, count: 8, percentage: 19.6 },
		regulatory: { amount: 200.75, count: 5, percentage: 6.0 },
		enhancement: { amount: 175.0, count: 3, percentage: 5.1 }
	};

	// Helper function from CategoryBreakdownChart component
	function convertDataObjectToArray(data: any) {
		return Object.entries(data).map(([category, info]: [string, any]) => ({
			category: category.charAt(0).toUpperCase() + category.slice(1),
			amount: info.amount,
			count: info.count,
			percentage: info.percentage
		}));
	}

	function calculateCategoryTotals(data: any) {
		const entries = Object.values(data) as any[];
		return {
			totalAmount: entries.reduce((sum, item) => sum + item.amount, 0),
			totalCount: entries.reduce((sum, item) => sum + item.count, 0),
			totalPercentage: entries.reduce((sum, item) => sum + item.percentage, 0)
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should convert data object to array format correctly', () => {
		const chartData = convertDataObjectToArray(mockCategoryData);

		expect(chartData).toHaveLength(5);
		expect(chartData[0]).toEqual({
			category: 'Operating',
			amount: 1500.5,
			count: 25,
			percentage: 45.2
		});
		expect(chartData[1]).toEqual({
			category: 'Maintenance',
			amount: 800.25,
			count: 12,
			percentage: 24.1
		});
	});

	it('should capitalize category names correctly', () => {
		const testData = {
			fuel: { amount: 100, count: 5, percentage: 50 },
			'oil-change': { amount: 50, count: 2, percentage: 25 },
			insurance: { amount: 50, count: 1, percentage: 25 }
		};

		const chartData = convertDataObjectToArray(testData);

		expect(chartData[0]?.category).toBe('Fuel');
		expect(chartData[1]?.category).toBe('Oil-change');
		expect(chartData[2]?.category).toBe('Insurance');
	});

	it('should calculate category totals correctly', () => {
		const totals = calculateCategoryTotals(mockCategoryData);

		expect(totals.totalAmount).toBeCloseTo(3326.5, 2);
		expect(totals.totalCount).toBe(53);
		expect(totals.totalPercentage).toBeCloseTo(100.0, 1);
	});

	it('should handle empty data gracefully', () => {
		const emptyData = {};
		const chartData = convertDataObjectToArray(emptyData);
		const totals = calculateCategoryTotals(emptyData);

		expect(chartData).toHaveLength(0);
		expect(totals.totalAmount).toBe(0);
		expect(totals.totalCount).toBe(0);
		expect(totals.totalPercentage).toBe(0);
	});

	it('should sort categories by amount descending', () => {
		const sortByAmount = (data: any[]) => {
			return [...data].sort((a, b) => b.amount - a.amount);
		};

		const chartData = convertDataObjectToArray(mockCategoryData);
		const sorted = sortByAmount(chartData);

		expect(sorted[0].category).toBe('Operating'); // $1500.50
		expect(sorted[1].category).toBe('Maintenance'); // $800.25
		expect(sorted[4].category).toBe('Enhancement'); // $175.00
	});

	it('should identify top spending categories', () => {
		const getTopCategories = (data: any, topN: number = 3) => {
			const chartData = convertDataObjectToArray(data);
			return chartData.sort((a, b) => b.amount - a.amount).slice(0, topN);
		};

		const top3 = getTopCategories(mockCategoryData, 3);

		expect(top3).toHaveLength(3);
		expect(top3[0]?.category).toBe('Operating');
		expect(top3[1]?.category).toBe('Maintenance');
		expect(top3[2]?.category).toBe('Financial');
	});

	it('should calculate percentage distribution correctly', () => {
		const validatePercentages = (data: any) => {
			const chartData = convertDataObjectToArray(data);
			const totalPercentage = chartData.reduce((sum, item) => sum + item.percentage, 0);

			return {
				isValid: Math.abs(totalPercentage - 100) < 0.1, // Allow small rounding errors
				totalPercentage,
				categories: chartData.map(item => ({
					category: item.category,
					percentage: item.percentage
				}))
			};
		};

		const validation = validatePercentages(mockCategoryData);

		expect(validation.isValid).toBe(true);
		expect(validation.totalPercentage).toBeCloseTo(100.0, 1);
	});
});

describe('Cost Trend Chart Logic', () => {
	const mockTrendData = [
		{ period: '2024-01', amount: 450.25 },
		{ period: '2024-02', amount: 520.75 },
		{ period: '2024-03', amount: 380.5 },
		{ period: '2024-04', amount: 610.0 },
		{ period: '2024-05', amount: 495.25 }
	];

	// Helper functions for trend analysis
	function calculateTrendStatistics(data: any[]) {
		if (data.length === 0) return null;

		const amounts = data.map(d => d.amount);
		const total = amounts.reduce((sum, amount) => sum + amount, 0);
		const average = total / amounts.length;
		const min = Math.min(...amounts);
		const max = Math.max(...amounts);

		return {
			total: total.toFixed(2),
			average: average.toFixed(2),
			min: min.toFixed(2),
			max: max.toFixed(2),
			count: amounts.length
		};
	}

	function calculateTrendDirection(data: any[]) {
		if (data.length < 2) return 'insufficient-data';

		const firstHalf = data.slice(0, Math.floor(data.length / 2));
		const secondHalf = data.slice(Math.floor(data.length / 2));

		const firstAvg = firstHalf.reduce((sum, d) => sum + d.amount, 0) / firstHalf.length;
		const secondAvg = secondHalf.reduce((sum, d) => sum + d.amount, 0) / secondHalf.length;

		const change = ((secondAvg - firstAvg) / firstAvg) * 100;

		if (change > 5) return 'increasing';
		if (change < -5) return 'decreasing';
		return 'stable';
	}

	function identifyOutliers(data: any[], threshold: number = 1.5) {
		if (data.length < 3) return [];

		const amounts = data.map(d => d.amount);
		const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
		const stdDev = Math.sqrt(
			amounts.reduce((sum, amount) => sum + Math.pow(amount - average, 2), 0) / amounts.length
		);

		return data.filter(d => Math.abs(d.amount - average) > threshold * stdDev);
	}

	function calculateMonthOverMonthChange(data: any[]) {
		if (data.length < 2) return [];

		return data.slice(1).map((current, index) => {
			const previous = data[index];
			const change = ((current.amount - previous.amount) / previous.amount) * 100;

			return {
				period: current.period,
				previousAmount: previous.amount,
				currentAmount: current.amount,
				change: change.toFixed(1),
				direction: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'no-change'
			};
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate trend statistics correctly', () => {
		const stats = calculateTrendStatistics(mockTrendData);

		expect(stats).toBeDefined();
		expect(stats?.total).toBe('2456.75'); // Sum of all amounts
		expect(stats?.average).toBe('491.35'); // Average
		expect(stats?.min).toBe('380.50'); // Minimum
		expect(stats?.max).toBe('610.00'); // Maximum
		expect(stats?.count).toBe(5);
	});

	it('should determine trend direction correctly', () => {
		// Increasing trend
		const increasingData = [
			{ period: '2024-01', amount: 300 },
			{ period: '2024-02', amount: 350 },
			{ period: '2024-03', amount: 500 },
			{ period: '2024-04', amount: 550 }
		];

		expect(calculateTrendDirection(increasingData)).toBe('increasing');

		// Decreasing trend
		const decreasingData = [
			{ period: '2024-01', amount: 600 },
			{ period: '2024-02', amount: 550 },
			{ period: '2024-03', amount: 400 },
			{ period: '2024-04', amount: 350 }
		];

		expect(calculateTrendDirection(decreasingData)).toBe('decreasing');

		// Stable trend
		const stableData = [
			{ period: '2024-01', amount: 500 },
			{ period: '2024-02', amount: 510 },
			{ period: '2024-03', amount: 490 },
			{ period: '2024-04', amount: 505 }
		];

		expect(calculateTrendDirection(stableData)).toBe('stable');
	});

	it('should identify outliers correctly', () => {
		const dataWithOutlier = [
			{ period: '2024-01', amount: 450 },
			{ period: '2024-02', amount: 460 },
			{ period: '2024-03', amount: 1200 }, // Outlier
			{ period: '2024-04', amount: 470 },
			{ period: '2024-05', amount: 455 }
		];

		const outliers = identifyOutliers(dataWithOutlier);

		expect(outliers).toHaveLength(1);
		expect(outliers[0].period).toBe('2024-03');
		expect(outliers[0].amount).toBe(1200);
	});

	it('should calculate month-over-month changes correctly', () => {
		const changes = calculateMonthOverMonthChange(mockTrendData);

		expect(changes).toHaveLength(4); // One less than input data

		// Feb vs Jan: (520.75 - 450.25) / 450.25 * 100 = 15.7%
		expect(changes[0]?.period).toBe('2024-02');
		expect(parseFloat(changes[0]?.change || '0')).toBeCloseTo(15.7, 0);
		expect(changes[0]?.direction).toBe('increase');

		// Mar vs Feb: (380.50 - 520.75) / 520.75 * 100 = -26.9%
		expect(changes[1]?.period).toBe('2024-03');
		expect(parseFloat(changes[1]?.change || '0')).toBeCloseTo(-26.9, 0);
		expect(changes[1]?.direction).toBe('decrease');
	});

	it('should handle empty data gracefully', () => {
		const stats = calculateTrendStatistics([]);
		const direction = calculateTrendDirection([]);
		const outliers = identifyOutliers([]);
		const changes = calculateMonthOverMonthChange([]);

		expect(stats).toBeNull();
		expect(direction).toBe('insufficient-data');
		expect(outliers).toHaveLength(0);
		expect(changes).toHaveLength(0);
	});

	it('should handle single data point', () => {
		const singlePoint = [{ period: '2024-01', amount: 500 }];

		const stats = calculateTrendStatistics(singlePoint);
		const direction = calculateTrendDirection(singlePoint);
		const changes = calculateMonthOverMonthChange(singlePoint);

		expect(stats?.count).toBe(1);
		expect(stats?.average).toBe('500.00');
		expect(direction).toBe('insufficient-data');
		expect(changes).toHaveLength(0);
	});

	it('should calculate percentage changes accurately', () => {
		const testData = [
			{ period: '2024-01', amount: 100 },
			{ period: '2024-02', amount: 150 }, // 50% increase
			{ period: '2024-03', amount: 75 } // 50% decrease
		];

		const changes = calculateMonthOverMonthChange(testData);

		expect(changes[0]?.change).toBe('50.0'); // 50% increase
		expect(changes[1]?.change).toBe('-50.0'); // 50% decrease
	});
});

describe('Fuel Efficiency Chart Logic', () => {
	const mockFuelData = [
		{ date: '2024-01-15', mpg: 32.1, mileage: 1000 },
		{ date: '2024-02-15', mpg: 31.5, mileage: 1500 },
		{ date: '2024-03-15', mpg: 25.2, mileage: 2000 }, // Efficiency drop
		{ date: '2024-04-15', mpg: 24.8, mileage: 2500 },
		{ date: '2024-05-15', mpg: 30.1, mileage: 3000 }
	];

	// Helper functions from FuelEfficiencyChart component
	function convertDataToChartFormat(data: any[]) {
		return data.map(item => ({
			period: item.date.substring(0, 7), // Convert to YYYY-MM format
			amount: item.mpg
		}));
	}

	function detectEfficiencyAlerts(chartData: any[], averageMPG: number) {
		if (chartData.length < 2 || averageMPG === 0) return [];

		const alerts = [];
		const recentReadings = chartData.slice(-3);
		const recentAverage =
			recentReadings.reduce((sum, d) => sum + (d.mpg || d.amount), 0) / recentReadings.length;

		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = (((averageMPG - recentAverage) / averageMPG) * 100).toFixed(1);
			alerts.push({
				type: 'efficiency_drop',
				message: `Recent fuel efficiency is ${dropPercentage}% below average`,
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium'
			});
		}

		return alerts;
	}

	function calculateSummaryStats(data: any[], averageMPG: number) {
		if (data.length === 0) return null;

		const mpgValues = data.map(d => d.mpg);

		return {
			averageMPG: averageMPG.toFixed(1),
			latestMPG: mpgValues[mpgValues.length - 1].toFixed(1),
			bestMPG: Math.max(...mpgValues).toFixed(1)
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should convert data to chart format correctly', () => {
		const chartData = convertDataToChartFormat(mockFuelData);

		expect(chartData).toEqual([
			{ period: '2024-01', amount: 32.1 },
			{ period: '2024-02', amount: 31.5 },
			{ period: '2024-03', amount: 25.2 },
			{ period: '2024-04', amount: 24.8 },
			{ period: '2024-05', amount: 30.1 }
		]);
	});

	it('should detect efficiency drop alerts correctly', () => {
		// Use data that will actually trigger an alert
		const dropData = [
			{ date: '2024-01-15', mpg: 32.1, mileage: 1000 },
			{ date: '2024-02-15', mpg: 31.5, mileage: 1500 },
			{ date: '2024-03-15', mpg: 24.0, mileage: 2000 }, // Recent readings: 24.0, 23.0, 24.0
			{ date: '2024-04-15', mpg: 23.0, mileage: 2500 }, // Average: 23.67 (78.9% of 30.0)
			{ date: '2024-05-15', mpg: 24.0, mileage: 3000 }
		];

		const alerts = detectEfficiencyAlerts(dropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.type).toBe('efficiency_drop');
		expect(alerts[0]?.severity).toBe('medium'); // Recent average is above 70% threshold
	});

	it('should determine high severity for significant drops', () => {
		const severeDropData = [
			{ date: '2024-01-15', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-15', mpg: 18.0, mileage: 1500 }, // Very low
			{ date: '2024-03-15', mpg: 17.0, mileage: 2000 },
			{ date: '2024-04-15', mpg: 16.0, mileage: 2500 }
		];

		const alerts = detectEfficiencyAlerts(severeDropData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.severity).toBe('high'); // Recent average is below 70% threshold
	});

	it('should calculate summary statistics correctly', () => {
		const stats = calculateSummaryStats(mockFuelData, 28.7);

		expect(stats).toBeDefined();
		expect(stats?.averageMPG).toBe('28.7');
		expect(stats?.latestMPG).toBe('30.1');
		expect(stats?.bestMPG).toBe('32.1');
	});

	it('should handle empty data gracefully', () => {
		const chartData = convertDataToChartFormat([]);
		const alerts = detectEfficiencyAlerts([], 30.0);
		const stats = calculateSummaryStats([], 28.7);

		expect(chartData).toHaveLength(0);
		expect(alerts).toHaveLength(0);
		expect(stats).toBeNull();
	});

	it('should calculate drop percentage accurately', () => {
		// Test with known values - need at least 3 readings for recent average
		const testData = [
			{ date: '2024-01-15', mpg: 30.0, mileage: 1000 },
			{ date: '2024-02-15', mpg: 20.0, mileage: 1500 }, // Recent readings: 20.0, 20.0, 20.0
			{ date: '2024-03-15', mpg: 20.0, mileage: 2000 }, // Average: 20.0
			{ date: '2024-04-15', mpg: 20.0, mileage: 2500 } // Drop: ((30-20)/30)*100 = 33.3%
		];

		const alerts = detectEfficiencyAlerts(testData, 30.0);

		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.message).toContain('33.3%'); // ((30-20)/30)*100 = 33.3%
	});
});

describe('Multi Trend Chart Logic', () => {
	const mockCostData = [
		{ period: '2024-01', amount: 450.25 },
		{ period: '2024-02', amount: 520.75 },
		{ period: '2024-03', amount: 380.5 }
	];

	const mockMilesData = [
		{ period: '2024-01', miles: 1200 },
		{ period: '2024-02', miles: 1350 },
		{ period: '2024-03', miles: 980 }
	];

	const mockCostPerMileData = [
		{ period: '2024-01', costPerMile: 0.375 },
		{ period: '2024-02', costPerMile: 0.386 },
		{ period: '2024-03', costPerMile: 0.388 }
	];

	// Helper functions from MultiTrendChart component
	function prepareChartData(
		selectedMetrics: string[],
		costData: any[],
		milesData: any[],
		costPerMileData: any[]
	) {
		const data: { [key: string]: any[] } = {};

		if (selectedMetrics.includes('cost')) {
			data['Monthly Cost'] = costData;
		}

		if (selectedMetrics.includes('miles')) {
			data['Miles Driven'] = milesData;
		}

		if (selectedMetrics.includes('costPerMile')) {
			data['Cost per Mile'] = costPerMileData;
		}

		return data;
	}

	function calculateSummaryStatistics(costData: any[], milesData: any[], costPerMileData: any[]) {
		const totalCost = costData.reduce((sum, d) => sum + (d.amount || 0), 0);
		const totalMiles = milesData.reduce((sum, d) => sum + (d.miles || 0), 0);
		const avgCostPerMile =
			costPerMileData.length > 0
				? costPerMileData.reduce((sum, d) => sum + (d.costPerMile || 0), 0) / costPerMileData.length
				: 0;

		return {
			totalCost: totalCost.toFixed(2),
			totalMiles: totalMiles.toLocaleString(),
			avgCostPerMile: avgCostPerMile.toFixed(3),
			avgCostPerMonth: costData.length > 0 ? (totalCost / costData.length).toFixed(2) : '0.00',
			avgMilesPerMonth:
				milesData.length > 0 ? Math.round(totalMiles / milesData.length).toLocaleString() : '0'
		};
	}

	function calculateCostPerMileRange(costPerMileData: any[]) {
		if (costPerMileData.length === 0) return null;

		const values = costPerMileData.map(d => d.costPerMile || 0);
		return {
			min: Math.min(...values).toFixed(3),
			max: Math.max(...values).toFixed(3)
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should prepare chart data based on selected metrics', () => {
		const allMetrics = prepareChartData(
			['cost', 'miles', 'costPerMile'],
			mockCostData,
			mockMilesData,
			mockCostPerMileData
		);

		expect(allMetrics).toEqual({
			'Monthly Cost': mockCostData,
			'Miles Driven': mockMilesData,
			'Cost per Mile': mockCostPerMileData
		});

		const partialMetrics = prepareChartData(
			['cost', 'miles'],
			mockCostData,
			mockMilesData,
			mockCostPerMileData
		);

		expect(partialMetrics).toEqual({
			'Monthly Cost': mockCostData,
			'Miles Driven': mockMilesData
		});
		expect(partialMetrics).not.toHaveProperty('Cost per Mile');
	});

	it('should calculate summary statistics correctly', () => {
		const stats = calculateSummaryStatistics(mockCostData, mockMilesData, mockCostPerMileData);

		// Total Cost: 450.25 + 520.75 + 380.50 = 1351.50
		expect(stats.totalCost).toBe('1351.50');

		// Total Miles: 1200 + 1350 + 980 = 3530
		expect(stats.totalMiles).toBe('3,530');

		// Average Cost per Mile: (0.375 + 0.386 + 0.388) / 3 = 0.383
		expect(stats.avgCostPerMile).toBe('0.383');

		// Average cost per month: 1351.50 / 3 = 450.50
		expect(stats.avgCostPerMonth).toBe('450.50');

		// Average miles per month: 3530 / 3 = 1177
		expect(stats.avgMilesPerMonth).toBe('1,177');
	});

	it('should calculate cost per mile range correctly', () => {
		const range = calculateCostPerMileRange(mockCostPerMileData);

		expect(range).toBeDefined();
		expect(range?.min).toBe('0.375');
		expect(range?.max).toBe('0.388');
	});

	it('should handle empty data gracefully', () => {
		const emptyData = prepareChartData(['cost', 'miles', 'costPerMile'], [], [], []);
		const emptyStats = calculateSummaryStatistics([], [], []);
		const emptyRange = calculateCostPerMileRange([]);

		expect(emptyData).toEqual({
			'Monthly Cost': [],
			'Miles Driven': [],
			'Cost per Mile': []
		});

		expect(emptyStats.totalCost).toBe('0.00');
		expect(emptyStats.totalMiles).toBe('0');
		expect(emptyStats.avgCostPerMile).toBe('0.000');

		expect(emptyRange).toBeNull();
	});

	it('should handle no selected metrics', () => {
		const noMetrics = prepareChartData([], mockCostData, mockMilesData, mockCostPerMileData);

		expect(noMetrics).toEqual({});
		expect(Object.keys(noMetrics)).toHaveLength(0);
	});

	it('should handle partial data correctly', () => {
		const partialCostData = [{ period: '2024-01', amount: 100 }];
		const partialMilesData = [
			{ period: '2024-01', miles: 500 },
			{ period: '2024-02', miles: 600 }
		];

		const stats = calculateSummaryStatistics(partialCostData, partialMilesData, []);

		expect(stats.totalCost).toBe('100.00');
		expect(stats.totalMiles).toBe('1,100');
		expect(stats.avgCostPerMile).toBe('0.000'); // No cost per mile data
		expect(stats.avgCostPerMonth).toBe('100.00'); // 100 / 1
		expect(stats.avgMilesPerMonth).toBe('550'); // 1100 / 2
	});

	it('should format numbers correctly', () => {
		const largeNumberData = [
			{ period: '2024-01', amount: 1234.567 },
			{ period: '2024-02', amount: 2345.678 }
		];

		const largeMilesData = [
			{ period: '2024-01', miles: 12345 },
			{ period: '2024-02', miles: 23456 }
		];

		const stats = calculateSummaryStatistics(largeNumberData, largeMilesData, []);

		expect(stats.totalCost).toBe('3580.24'); // Rounded to 2 decimal places
		expect(stats.totalMiles).toBe('35,801'); // Formatted with commas
		expect(stats.avgCostPerMonth).toBe('1790.12'); // Average with 2 decimal places
		expect(stats.avgMilesPerMonth).toBe('17,901'); // Average formatted with commas
	});
});
