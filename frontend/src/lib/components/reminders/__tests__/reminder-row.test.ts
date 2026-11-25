import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReminderWithVehicles } from '#lib/types/index.ts';
import ReminderRow from '../ReminderRow.svelte';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

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
			nextDueDate: '2026-12-03T12:00:00.000Z',
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

afterEach(cleanup);

describe('ReminderRow status', () => {
	test('a due reminder says Due now', () => {
		renderRow(item({ nextDueDate: '2026-11-20T12:00:00.000Z' }), 'due');
		expect(screen.getByText('Due now')).toHaveClass('text-warning');
	});

	test('an upcoming date counts the days left, in the warning colour within 30 days', () => {
		renderRow(item(), 'upcoming');
		expect(screen.getByText('In 8 days')).toHaveClass('text-warning');
	});

	test('a date further out than 30 days is muted', () => {
		renderRow(item({ nextDueDate: '2027-02-01T12:00:00.000Z' }), 'upcoming');
		expect(screen.getByText('In 68 days')).toHaveClass('text-muted-foreground');
	});

	test('an odometer-only reminder names the reading and offers Mark serviced', () => {
		renderRow(
			item({ triggerMode: 'mileage', nextDueDate: null, nextDueOdometer: 40000 }),
			'upcoming'
		);
		expect(screen.getByText('At 40,000')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Mark serviced' })).toBeInTheDocument();
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
		expect(screen.getByTestId('reminder-card-r1').textContent).toContain('Daily Driver · ');
		expect(screen.getByTestId('reminder-card-r1').textContent).toContain('~$312.00 · monthly');
	});
});
