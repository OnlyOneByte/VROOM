import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { signInAsDemo } from '../../../../test-utils/demo-user';
import type { ReminderWithVehicles } from '#lib/types/index.ts';
import ReminderRow from '../ReminderRow.svelte';

const localNoon = (year: number, month: number, day: number) =>
	new Date(year, month - 1, day, 12).toISOString();
const NOW = new Date(2026, 10, 25, 9).getTime();

function item(overrides: Partial<ReminderWithVehicles['reminder']> = {}, vehicleIds = ['v1']) {
	return {
		reminder: {
			id: 'r1',
			name: 'Oil change',
			type: 'notification',
			isActive: true,
			triggerMode: 'time',
			frequency: 'monthly',
			intervalValue: null,
			intervalUnit: null,
			nextDueDate: localNoon(2026, 12, 3),
			nextDueOdometer: null,
			expenseAmount: null,
			description: null,
			...overrides
		},
		vehicleIds
	} as unknown as ReminderWithVehicles;
}

function renderRow(row: ReminderWithVehicles, group: 'due' | 'upcoming' | 'paused') {
	const handlers = {
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		onToggleActive: vi.fn(),
		onMarkServiced: vi.fn(),
		onViewExpenses: vi.fn()
	};
	render(ReminderRow, {
		props: {
			item: row,
			group,
			vehicleNames: new Map([['v1', 'Daily Driver']]),
			servicing: false,
			now: NOW,
			...handlers
		}
	});
	return handlers;
}

const rowText = () =>
	screen.getByTestId('reminder-card-r1').textContent?.replace(/\u00a0/g, ' ') ?? '';

afterEach(cleanup);

describe('ReminderRow status', () => {
	test('a due reminder says Due now', () => {
		renderRow(item({ nextDueDate: localNoon(2026, 11, 20) }), 'due');
		expect(screen.getByText('Due now')).toHaveClass('text-warning');
	});

	test('in the morning, an upcoming date counts calendar days, in the warning colour within 30 days', () => {
		renderRow(item(), 'upcoming');
		expect(screen.getByText('In 8 days')).toHaveClass('text-warning');
	});

	test('a reminder due at noon today reads Today in the morning, and tomorrow’s reads Tomorrow', () => {
		renderRow(item({ nextDueDate: localNoon(2026, 11, 25) }), 'upcoming');
		expect(screen.getByText('Today')).toBeInTheDocument();
		cleanup();

		renderRow(item({ nextDueDate: localNoon(2026, 11, 26) }), 'upcoming');
		expect(screen.getByText('Tomorrow')).toBeInTheDocument();
	});

	test('a date further out than 30 days is muted', () => {
		renderRow(item({ nextDueDate: localNoon(2027, 2, 1) }), 'upcoming');
		expect(screen.getByText('In 68 days')).toHaveClass('text-muted-foreground');
	});

	const odometerOnly = (currentOdometer?: number | null) => ({
		...item({ triggerMode: 'mileage', nextDueDate: null, nextDueOdometer: 43000 }),
		currentOdometer
	});

	test('an upcoming odometer reminder says how far is left, muted while it is still far', () => {
		renderRow(odometerOnly(40360), 'upcoming');
		expect(screen.getByText('In 2,640 mi')).toHaveClass('text-muted-foreground');
		expect(rowText()).not.toContain('on the odometer');
	});

	function renderUpcoming(currentOdometer: number, distanceLabel: string, servicing = false) {
		render(ReminderRow, {
			props: {
				item: odometerOnly(currentOdometer),
				group: 'upcoming',
				vehicleNames: new Map(),
				servicing,
				distanceLabel,
				now: NOW,
				onEdit: vi.fn(),
				onDelete: vi.fn(),
				onToggleActive: vi.fn(),
				onMarkServiced: vi.fn(),
				onViewExpenses: vi.fn()
			}
		});
	}

	test('it turns to the warning colour within about 1,000 miles, so 1,600 km on a metric car', () => {
		renderUpcoming(41800, 'mi');
		expect(screen.getByText('In 1,200 mi')).toHaveClass('text-muted-foreground');
		cleanup();

		renderUpcoming(41800, 'km');
		expect(screen.getByText('In 1,200 km')).toHaveClass('text-warning');
		cleanup();

		renderUpcoming(41300, 'km');
		expect(screen.getByText('In 1,700 km')).toHaveClass('text-muted-foreground');
	});

	test('while it is being marked serviced from the menu, the row says so', () => {
		renderUpcoming(40360, 'mi', true);
		expect(screen.getByRole('status')).toHaveTextContent('Marking serviced…');
	});

	test('with no reading yet it names the target reading', () => {
		renderRow(odometerOnly(null), 'upcoming');
		expect(screen.getByText('At 43,000 mi')).toHaveClass('text-muted-foreground');
	});

	test('before it is due, Mark serviced waits in the actions menu', async () => {
		const handlers = renderRow(odometerOnly(40360), 'upcoming');
		expect(screen.queryByRole('button', { name: 'Mark serviced' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'More actions for Oil change' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Mark serviced' }));
		expect(handlers.onMarkServiced).toHaveBeenCalledTimes(1);
	});

	test('once due, Mark serviced is offered in the row', () => {
		const handlers = renderRow(odometerOnly(43100), 'due');
		expect(screen.getByText('Due now')).toHaveClass('text-warning');
		screen.getByRole('button', { name: 'Mark serviced' }).click();
		expect(handlers.onMarkServiced).toHaveBeenCalledTimes(1);
	});

	test('a paused reminder with a vehicle offers Resume; one without a vehicle explains why not', () => {
		const handlers = renderRow(item({ isActive: false }), 'paused');
		screen.getByRole('button', { name: 'Resume' }).click();
		expect(handlers.onToggleActive).toHaveBeenCalledTimes(1);
		cleanup();

		renderRow(item({ isActive: false }, []), 'paused');
		expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
		expect(screen.getByText('No vehicle. Edit to choose one, then resume.')).toBeInTheDocument();
	});

	test('the meta line joins the vehicle, the date, the amount and the frequency', () => {
		renderRow(item({ type: 'expense', expenseAmount: 312 }), 'upcoming');
		expect(rowText()).toContain('Daily Driver · ');
		expect(rowText()).toContain('~$312.00 · monthly');
		expect(screen.getByTestId('reminder-card-r1').textContent).toContain('Dec\u00a03,\u00a02026');
	});
});

describe('ReminderRow meta line on a narrow screen', () => {
	test('it can wrap between cars, and each car name stays whole', () => {
		render(ReminderRow, {
			props: {
				item: item({}, ['v1', 'v2']),
				group: 'upcoming',
				vehicleNames: new Map([
					['v1', 'Daily Driver'],
					['v2', 'Weekend Car']
				]),
				servicing: false,
				now: NOW,
				onEdit: vi.fn(),
				onDelete: vi.fn(),
				onToggleActive: vi.fn(),
				onMarkServiced: vi.fn(),
				onViewExpenses: vi.fn()
			}
		});

		const text = screen.getByTestId('reminder-card-r1').textContent ?? '';
		expect(text).toContain('Daily\u00a0Driver, Weekend\u00a0Car · ');
	});
});

describe('ReminderRow in the demo', () => {
	test('the actions menu keeps Edit but has no Delete', async () => {
		const signOut = signInAsDemo();
		try {
			renderRow(item(), 'upcoming');
			await fireEvent.click(screen.getByRole('button', { name: 'More actions for Oil change' }));

			expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
		} finally {
			signOut();
		}
	});
});
