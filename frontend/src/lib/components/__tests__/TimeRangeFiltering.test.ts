import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the analytics API
vi.mock('$lib/utils/analytics-api', () => ({
	getDashboardAnalytics: vi.fn(),
	getTrendData: vi.fn(),
	getFuelEfficiency: vi.fn()
}));

describe('Interactive Time Range Filtering Logic', () => {
	// Helper functions for time range filtering
	function calculateDateRange(rangeType: string, currentDate: Date = new Date()) {
		const start = new Date(currentDate);
		const end = new Date(currentDate);

		switch (rangeType) {
			case 'last30days':
				start.setDate(currentDate.getDate() - 30);
				break;
			case 'last3months':
				start.setMonth(currentDate.getMonth() - 3);
				break;
			case 'last6months':
				start.setMonth(currentDate.getMonth() - 6);
				break;
			case 'lastyear':
				start.setFullYear(currentDate.getFullYear() - 1);
				break;
			case 'ytd':
				start.setMonth(0, 1); // January 1st of current year
				break;
			default:
				return null;
		}

		return {
			startDate: start.toISOString().split('T')[0],
			endDate: end.toISOString().split('T')[0]
		};
	}

	function validateDateRange(startDate: string, endDate: string) {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const now = new Date();

		const errors = [];

		if (isNaN(start.getTime())) {
			errors.push('Invalid start date');
		}

		if (isNaN(end.getTime())) {
			errors.push('Invalid end date');
		}

		if (start > end) {
			errors.push('Start date must be before end date');
		}

		if (end > now) {
			errors.push('End date cannot be in the future');
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}

	function filterDataByDateRange(
		data: any[],
		startDate: string,
		endDate: string,
		dateField: string = 'period'
	) {
		return data.filter(item => {
			const itemDate = item[dateField];
			return itemDate >= startDate && itemDate <= endDate;
		});
	}

	function aggregateDataByGrouping(data: any[], groupBy: 'day' | 'week' | 'month' | 'year') {
		const grouped: { [key: string]: any[] } = {};

		data.forEach(item => {
			let key: string;
			const date = new Date(item.period || item.date);

			switch (groupBy) {
				case 'day':
					key = date.toISOString().split('T')[0] || ''; // YYYY-MM-DD
					break;
				case 'week': {
					const weekStart = new Date(date);
					weekStart.setDate(date.getDate() - date.getDay());
					key = weekStart.toISOString().split('T')[0] || '';
					break;
				}
				case 'month':
					key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
					break;
				case 'year':
					key = String(date.getFullYear());
					break;
				default:
					key = item.period || item.date || '';
			}

			if (!grouped[key]) {
				grouped[key] = [];
			}
			grouped[key]?.push(item);
		});

		// Aggregate values for each group
		return Object.entries(grouped).map(([period, items]) => ({
			period,
			amount: items.reduce((sum, item) => sum + (item.amount || 0), 0),
			count: items.length
		}));
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should calculate date ranges correctly for quick filters', () => {
		const mockDate = new Date('2024-06-15T12:00:00Z');

		const last30Days = calculateDateRange('last30days', mockDate);
		expect(last30Days?.startDate).toBe('2024-05-16');
		expect(last30Days?.endDate).toBe('2024-06-15');

		const last3Months = calculateDateRange('last3months', mockDate);
		expect(last3Months?.startDate).toBe('2024-03-15');
		expect(last3Months?.endDate).toBe('2024-06-15');

		const ytd = calculateDateRange('ytd', mockDate);
		expect(ytd?.startDate).toBe('2024-01-01');
		expect(ytd?.endDate).toBe('2024-06-15');
	});

	it('should validate date ranges correctly', () => {
		const validRange = validateDateRange('2024-01-01', '2024-06-15');
		expect(validRange.isValid).toBe(true);
		expect(validRange.errors).toHaveLength(0);

		const invalidStartDate = validateDateRange('invalid-date', '2024-06-15');
		expect(invalidStartDate.isValid).toBe(false);
		expect(invalidStartDate.errors).toContain('Invalid start date');

		const reversedRange = validateDateRange('2024-06-15', '2024-01-01');
		expect(reversedRange.isValid).toBe(false);
		expect(reversedRange.errors).toContain('Start date must be before end date');

		const futureDate = validateDateRange('2024-01-01', '2025-12-31');
		expect(futureDate.isValid).toBe(false);
		expect(futureDate.errors).toContain('End date cannot be in the future');
	});

	it('should filter data by date range correctly', () => {
		const mockData = [
			{ period: '2024-01-15', amount: 100 },
			{ period: '2024-02-15', amount: 200 },
			{ period: '2024-03-15', amount: 300 },
			{ period: '2024-04-15', amount: 400 }
		];

		const filtered = filterDataByDateRange(mockData, '2024-02-01', '2024-03-31');

		expect(filtered).toHaveLength(2);
		expect(filtered[0].period).toBe('2024-02-15');
		expect(filtered[1].period).toBe('2024-03-15');
	});

	it('should aggregate data by different groupings', () => {
		const mockData = [
			{ period: '2024-01-15', amount: 100 },
			{ period: '2024-01-25', amount: 150 },
			{ period: '2024-02-05', amount: 200 },
			{ period: '2024-02-15', amount: 250 }
		];

		const monthlyAggregated = aggregateDataByGrouping(mockData, 'month');

		expect(monthlyAggregated).toHaveLength(2);
		expect(monthlyAggregated[0]?.period).toBe('2024-01');
		expect(monthlyAggregated[0]?.amount).toBe(250); // 100 + 150
		expect(monthlyAggregated[0]?.count).toBe(2);

		expect(monthlyAggregated[1]?.period).toBe('2024-02');
		expect(monthlyAggregated[1]?.amount).toBe(450); // 200 + 250
		expect(monthlyAggregated[1]?.count).toBe(2);
	});

	it('should handle year grouping correctly', () => {
		const mockData = [
			{ period: '2023-12-15', amount: 100 },
			{ period: '2024-01-15', amount: 200 },
			{ period: '2024-06-15', amount: 300 }
		];

		const yearlyAggregated = aggregateDataByGrouping(mockData, 'year');

		expect(yearlyAggregated).toHaveLength(2);
		expect(yearlyAggregated.find(item => item.period === '2023')?.amount).toBe(100);
		expect(yearlyAggregated.find(item => item.period === '2024')?.amount).toBe(500);
	});

	it('should handle week grouping correctly', () => {
		// Test with a known Monday (2024-01-15 is a Monday)
		const mockData = [
			{ period: '2024-01-15', amount: 100 }, // Monday
			{ period: '2024-01-17', amount: 150 }, // Wednesday (same week)
			{ period: '2024-01-22', amount: 200 } // Next Monday
		];

		const weeklyAggregated = aggregateDataByGrouping(mockData, 'week');

		expect(weeklyAggregated).toHaveLength(2);
		// First week should have combined amount
		const firstWeek = weeklyAggregated.find(item => item.amount === 250);
		expect(firstWeek).toBeDefined();
		expect(firstWeek?.count).toBe(2);
	});

	it('should handle empty data gracefully', () => {
		const emptyFiltered = filterDataByDateRange([], '2024-01-01', '2024-12-31');
		const emptyAggregated = aggregateDataByGrouping([], 'month');

		expect(emptyFiltered).toHaveLength(0);
		expect(emptyAggregated).toHaveLength(0);
	});

	it('should handle invalid range types', () => {
		const invalidRange = calculateDateRange('invalid-range');
		expect(invalidRange).toBeNull();
	});

	it('should calculate correct date ranges for edge cases', () => {
		// Test with end of month
		const endOfMonth = new Date('2024-01-31T12:00:00Z');

		const last3MonthsFromEndOfMonth = calculateDateRange('last3months', endOfMonth);
		expect(last3MonthsFromEndOfMonth?.startDate).toBe('2023-10-31');

		// Test with leap year
		const leapYearDate = new Date('2024-02-29T12:00:00Z');
		const ytdFromLeapYear = calculateDateRange('ytd', leapYearDate);
		expect(ytdFromLeapYear?.startDate).toBe('2024-01-01');
		expect(ytdFromLeapYear?.endDate).toBe('2024-02-29');
	});

	it('should preserve data structure when filtering', () => {
		const mockDataWithExtraFields = [
			{ period: '2024-01-15', amount: 100, category: 'fuel', vehicle: 'car1' },
			{ period: '2024-02-15', amount: 200, category: 'maintenance', vehicle: 'car2' },
			{ period: '2024-03-15', amount: 300, category: 'fuel', vehicle: 'car1' }
		];

		const filtered = filterDataByDateRange(mockDataWithExtraFields, '2024-02-01', '2024-02-28');

		expect(filtered).toHaveLength(1);
		expect(filtered[0]).toEqual({
			period: '2024-02-15',
			amount: 200,
			category: 'maintenance',
			vehicle: 'car2'
		});
	});
});
