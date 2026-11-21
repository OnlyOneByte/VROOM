import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { InsuranceTerm } from '#lib/types/index.ts';
import { makeTerm as term, settle } from './insurance-fixtures.ts';

const PolicyTermCard = (await import('../PolicyTermCard.svelte')).default;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('PolicyTermCard content', () => {
	test('a current term shows only its expiry date', () => {
		render(PolicyTermCard, { props: { term: term(), isCurrent: true } });
		expect(screen.getByText('Current Term')).toBeInTheDocument();
		expect(screen.getByText('Expires')).toBeInTheDocument();
		expect(screen.getByText('Jun 1, 2026')).toBeInTheDocument();
		expect(screen.queryByText('Start')).toBeNull();
	});

	test('a past term shows both start and end dates', () => {
		render(PolicyTermCard, { props: { term: term() } });
		expect(screen.getByText('Past Term')).toBeInTheDocument();
		expect(screen.getByText('Start')).toBeInTheDocument();
		expect(screen.getByText('Jun 1, 2025')).toBeInTheDocument();
		expect(screen.getByText('End')).toBeInTheDocument();
		expect(screen.getByText('Jun 1, 2026')).toBeInTheDocument();
		expect(screen.queryByText('Expires')).toBeNull();
	});

	test('formats total and monthly costs as currency and lists vehicles', () => {
		render(PolicyTermCard, {
			props: {
				term: term({ totalCost: 1234.5, monthlyCost: 102.88, coverageDescription: 'Full cover' }),
				vehicleNames: ['Daily', '2019 Honda Civic']
			}
		});
		expect(screen.getByText('$1,234.50')).toBeInTheDocument();
		expect(screen.getByText('$102.88/mo')).toBeInTheDocument();
		expect(screen.getByText('Daily, 2019 Honda Civic')).toBeInTheDocument();
		expect(screen.getByText('Full cover')).toBeInTheDocument();
	});

	test('a zero total cost is still shown', () => {
		render(PolicyTermCard, { props: { term: term({ totalCost: 0 }) } });
		expect(screen.getByText('Total Cost')).toBeInTheDocument();
		expect(screen.getByText('$0.00')).toBeInTheDocument();
	});

	test('omits cost, vehicle and coverage rows when the data is absent', () => {
		render(PolicyTermCard, { props: { term: term() } });
		expect(screen.queryByText('Total Cost')).toBeNull();
		expect(screen.queryByText('Monthly')).toBeNull();
		expect(screen.queryByText('Vehicles')).toBeNull();
	});
});

describe('PolicyTermCard actions', () => {
	test('renders no action buttons when no handlers are given', () => {
		render(PolicyTermCard, { props: { term: term(), isCurrent: true } });
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});

	test('edit passes the term to the handler', async () => {
		const onEdit = vi.fn<(t: InsuranceTerm) => void>();
		const t = term();
		render(PolicyTermCard, { props: { term: t, onEdit } });
		await fireEvent.click(screen.getByTitle('Edit term'));
		expect(onEdit).toHaveBeenCalledWith(t);
	});

	test('renew is only offered on the current term', async () => {
		const onRenew = vi.fn();
		const { unmount } = render(PolicyTermCard, { props: { term: term(), onRenew } });
		expect(screen.queryByRole('button', { name: /renew/i })).toBeNull();
		unmount();
		render(PolicyTermCard, { props: { term: term(), isCurrent: true, onRenew } });
		await fireEvent.click(screen.getByRole('button', { name: /renew/i }));
		expect(onRenew).toHaveBeenCalledTimes(1);
	});

	test('delete asks for confirmation before calling the handler', async () => {
		const onDelete = vi.fn<(t: InsuranceTerm) => void>();
		const t = term();
		render(PolicyTermCard, { props: { term: t, onDelete } });
		await fireEvent.click(screen.getByTitle('Delete term'));
		await settle();
		expect(onDelete).not.toHaveBeenCalled();
		const dialog = screen.getByRole('alertdialog');
		expect(within(dialog).getByText('Delete term?')).toBeInTheDocument();
		expect(within(dialog).getByText(/premium expense/)).toBeInTheDocument();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();
		expect(onDelete).toHaveBeenCalledWith(t);
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('cancelling the confirmation leaves the term untouched', async () => {
		const onDelete = vi.fn<(t: InsuranceTerm) => void>();
		render(PolicyTermCard, { props: { term: term(), onDelete } });
		await fireEvent.click(screen.getByTitle('Delete term'));
		await settle();
		await fireEvent.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
		);
		await settle();
		expect(onDelete).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});
});
