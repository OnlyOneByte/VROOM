import { describe, expect, test } from 'vitest';
import type { ExpenseSummary, InsurancePolicy, ReminderWithVehicles } from '#lib/types/index.ts';
import {
	attentionItems,
	combinePeriodSpend,
	highestMonth,
	percentChange,
	RUNNING_CATEGORIES
} from '../dashboard-data';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 23, 12).getTime();

function summary(overrides: Partial<ExpenseSummary>): ExpenseSummary {
	return {
		totalAmount: 0,
		expenseCount: 0,
		monthlyAverage: 0,
		recentAmount: 0,
		categoryBreakdown: [],
		monthlyTrend: [],
		costBuckets: { ownershipTotal: 0, runningTotal: 0, previous: null, byVehicle: [] },
		...overrides
	};
}

describe('dashboard data', () => {
	test('running categories are every category but financial', () => {
		expect(RUNNING_CATEGORIES).toEqual([
			'fuel',
			'maintenance',
			'regulatory',
			'enhancement',
			'misc'
		]);
	});

	test('owned and shared summaries add up, per vehicle and for the period before', () => {
		const spend = combinePeriodSpend([
			summary({
				totalAmount: 100,
				categoryBreakdown: [{ category: 'fuel', amount: 100, count: 2 }],
				costBuckets: {
					ownershipTotal: 0,
					runningTotal: 100,
					previous: { ownershipTotal: 50, runningTotal: 30 },
					byVehicle: [{ vehicleId: 'v1', ownershipTotal: 0, runningTotal: 100, previous: null }]
				}
			}),
			summary({
				totalAmount: 40,
				categoryBreakdown: [{ category: 'financial', amount: 40, count: 1 }],
				costBuckets: {
					ownershipTotal: 40,
					runningTotal: 0,
					previous: { ownershipTotal: 40, runningTotal: 0 },
					byVehicle: [{ vehicleId: 'v2', ownershipTotal: 40, runningTotal: 0, previous: null }]
				}
			})
		]);

		expect(spend.total).toBe(140);
		expect(spend.previousTotal).toBe(120);
		expect(spend.buckets).toEqual({ ownership: 40, energy: 100, upkeep: 0 });
		expect([...spend.byVehicle]).toEqual([
			['v1', 100],
			['v2', 40]
		]);
	});

	test('all time has no previous period, so there is no change to show', () => {
		expect(combinePeriodSpend([summary({ totalAmount: 10 })]).previousTotal).toBeNull();
		expect(percentChange(10, null)).toBeNull();
		expect(percentChange(10, 0)).toBeNull();
		expect(percentChange(94, 100)).toBe(-6);
		expect(percentChange(112, 100)).toBe(12);
	});

	test('needs attention lists overdue and soon reminders and renewals, soonest first', () => {
		const reminders = [
			{
				reminder: {
					id: 'r1',
					name: 'Oil change',
					isActive: true,
					nextDueDate: new Date(NOW - 2 * DAY).toISOString()
				},
				vehicleIds: ['v1']
			},
			{
				reminder: {
					id: 'r2',
					name: 'Rotation',
					isActive: true,
					nextDueDate: new Date(NOW + 5 * DAY).toISOString()
				},
				vehicleIds: []
			},
			{
				reminder: {
					id: 'r3',
					name: 'Far off',
					isActive: true,
					nextDueDate: new Date(NOW + 30 * DAY).toISOString()
				},
				vehicleIds: []
			},
			{
				reminder: {
					id: 'r4',
					name: 'Paused',
					isActive: false,
					nextDueDate: new Date(NOW).toISOString()
				},
				vehicleIds: []
			}
		] as unknown as ReminderWithVehicles[];
		const policies = [
			{
				id: 'p1',
				company: 'State Farm',
				isActive: true,
				terms: [{ endDate: new Date(NOW + 40 * DAY).toISOString() }]
			},
			{
				id: 'p2',
				company: 'Later Co',
				isActive: true,
				terms: [{ endDate: new Date(NOW + 90 * DAY).toISOString() }]
			},
			{
				id: 'p3',
				company: 'Old Co',
				isActive: false,
				terms: [{ endDate: new Date(NOW).toISOString() }]
			},
			{
				id: 'p4',
				company: 'Lapsed Co',
				isActive: true,
				terms: [{ endDate: new Date(NOW - 10 * DAY).toISOString() }]
			},
			{
				id: 'p5',
				company: 'Long Gone',
				isActive: true,
				terms: [{ endDate: new Date(NOW - 400 * DAY).toISOString() }]
			}
		] as unknown as InsurancePolicy[];

		const items = attentionItems(
			reminders,
			policies,
			id => (id === 'v1' ? 'Daily Driver' : undefined),
			date => date.toISOString().slice(0, 10),
			NOW
		);

		expect(items.map(item => [item.title, item.status])).toEqual([
			['Lapsed Co renewal', 'overdue'],
			['Oil change · Daily Driver', 'overdue'],
			['Rotation', 'soon'],
			['State Farm renewal', 'soon']
		]);
		expect(items[1]?.detail).toMatch(/^Was due /);
		expect(items[0]?.detail).toMatch(/^Ended /);
	});

	test('a mileage reminder that has reached its milestone needs attention', () => {
		const reminders = [
			{
				reminder: {
					id: 'm1',
					name: 'Oil change',
					isActive: true,
					nextDueDate: null,
					nextDueOdometer: 45000
				},
				vehicleIds: ['v1'],
				mileageDue: true
			},
			{
				reminder: {
					id: 'm2',
					name: 'Tyres',
					isActive: true,
					nextDueDate: null,
					nextDueOdometer: 60000
				},
				vehicleIds: ['v1'],
				mileageDue: false
			}
		] as unknown as ReminderWithVehicles[];

		const items = attentionItems(reminders, [], () => 'Daily Driver', String, NOW);

		expect(items.map(item => [item.title, item.status, item.detail])).toEqual([
			['Oil change · Daily Driver', 'overdue', 'Reached 45,000 mi']
		]);
	});

	test('a mileage reminder within about 1,000 miles of its reading is coming up soon, in the car’s unit', () => {
		const mileage = (id: string, nextDueOdometer: number, currentOdometer: number | null) => ({
			reminder: { id, name: id, isActive: true, nextDueDate: null, nextDueOdometer },
			vehicleIds: [id.startsWith('metric') ? 'v2' : 'v1'],
			mileageDue: false,
			currentOdometer
		});
		const reminders = [
			mileage('brakes', 41000, 40360),
			mileage('oil', 43000, 40360),
			mileage('unread', 41000, null),
			mileage('metric-close', 50000, 48600),
			mileage('metric-far', 50000, 48300)
		] as unknown as ReminderWithVehicles[];

		const items = attentionItems(
			reminders,
			[],
			() => undefined,
			String,
			NOW,
			id => (id === 'v2' ? 'km' : 'mi')
		);

		expect(items.map(item => [item.title, item.status, item.detail])).toEqual([
			['brakes', 'soon', 'Due in 640 mi'],
			['metric-close', 'soon', 'Due in 1,400 km']
		]);
	});

	test('overdue items come first, then dated ones coming up, then mileage close by, whatever order they arrive in', () => {
		const reminders = [
			{
				reminder: {
					id: 'brakes',
					name: 'Brake check',
					isActive: true,
					triggerMode: 'mileage',
					nextDueDate: null,
					nextDueOdometer: 41000
				},
				vehicleIds: ['v1'],
				mileageDue: false,
				currentOdometer: 40360
			},
			{
				reminder: {
					id: 'wash',
					name: 'Car wash',
					isActive: true,
					triggerMode: 'time',
					nextDueDate: new Date(NOW + DAY).toISOString(),
					nextDueOdometer: null
				},
				vehicleIds: ['v1'],
				mileageDue: false,
				currentOdometer: null
			},
			{
				reminder: {
					id: 'tyres',
					name: 'Tyre rotation',
					isActive: true,
					triggerMode: 'mileage',
					nextDueDate: null,
					nextDueOdometer: 40000
				},
				vehicleIds: ['v1'],
				mileageDue: true,
				currentOdometer: 40360
			}
		] as unknown as ReminderWithVehicles[];

		const items = attentionItems(reminders, [], () => undefined, String, NOW);

		expect(items.map(item => [item.title, item.status])).toEqual([
			['Tyre rotation', 'overdue'],
			['Car wash', 'soon'],
			['Brake check', 'soon']
		]);
		expect(items[0]?.detail).toBe('Reached 40,000 mi');
	});

	test('a date-and-mileage reminder whose date is far off still shows when its mileage is close', () => {
		const reminders = [
			{
				reminder: {
					id: 'service',
					name: 'Service',
					isActive: true,
					triggerMode: 'both',
					nextDueDate: new Date(NOW + 200 * DAY).toISOString(),
					nextDueOdometer: 41000
				},
				vehicleIds: ['v1'],
				mileageDue: false,
				currentOdometer: 40500
			}
		] as unknown as ReminderWithVehicles[];

		const items = attentionItems(reminders, [], () => undefined, String, NOW);
		expect(items.map(item => [item.status, item.detail])).toEqual([['soon', 'Due in 500 mi']]);
	});

	test('a dated reminder due soon is listed by its date even when its mileage is close too', () => {
		const reminders = [
			{
				reminder: {
					id: 'both',
					name: 'Service',
					isActive: true,
					nextDueDate: new Date(NOW + 3 * 86_400_000).toISOString(),
					nextDueOdometer: 41000
				},
				vehicleIds: ['v1'],
				mileageDue: false,
				currentOdometer: 40500
			}
		] as unknown as ReminderWithVehicles[];

		const [item] = attentionItems(
			reminders,
			[],
			() => undefined,
			() => 'in 3 days',
			NOW
		);
		expect(item?.detail).toBe('Due in 3 days');
	});

	test('the insight names the highest month, and nothing when every month is zero', () => {
		const aug = new Date(2026, 7, 1);
		expect(
			highestMonth([
				{ date: new Date(2026, 6, 1), amount: 300 },
				{ date: aug, amount: 812 }
			])
		).toEqual({ date: aug, amount: 812 });
		expect(highestMonth([{ date: aug, amount: 0 }])).toBeNull();
	});
});
