import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DashboardHero from '../DashboardHero.svelte';

const BASE = {
	period: '30d' as const,
	total: 624.04,
	previousTotal: 664,
	buckets: { ownership: 372.86, energy: 168.19, upkeep: 82.99 },
	runningPerDistance: 0.21,
	distanceLabel: 'mi',
	isLoading: false,
	onPeriodChange: () => {}
};

describe('DashboardHero', () => {
	test('leads with the period spend at hero size, its change and the running cost per distance', () => {
		const { container } = render(DashboardHero, { props: BASE });

		expect(screen.getByText('Spent in the last 30 days')).toBeInTheDocument();
		expect(screen.getByText('$624.04')).toHaveClass('text-4xl');
		const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(text).toContain('6% less than the 30 days before');
		expect(text).toContain('$0.21/mi running cost');
		expect(screen.getByRole('combobox', { name: 'Period: 30 days' })).toBeInTheDocument();
	});

	test('the split bar has one segment per bucket with spend, and a legend with every value', () => {
		render(DashboardHero, {
			props: { ...BASE, buckets: { ownership: 300, energy: 100, upkeep: 0 } }
		});

		const bar = screen.getByTestId('dashboard-split-bar');
		const widths = [...bar.children].map(seg => (seg as HTMLElement).style.width);
		expect(widths).toEqual(['75%', '25%']);
		expect(screen.getByRole('list').textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Ownership $300 Fuel & charging $100 Upkeep $0'
		);
	});

	test('with no spend, all time, and no distance it shows only the figure', () => {
		const { container } = render(DashboardHero, {
			props: {
				...BASE,
				period: 'all',
				total: 0,
				previousTotal: null,
				buckets: { ownership: 0, energy: 0, upkeep: 0 },
				runningPerDistance: null
			}
		});

		expect(screen.getByText('Spent all time')).toBeInTheDocument();
		expect(screen.queryByTestId('dashboard-split-bar')).toBeNull();
		expect(container.querySelector('section')?.children).toHaveLength(1);
		expect(container.textContent).not.toMatch(/than|running cost/);
	});

	test('while loading it keeps the label and chip and reserves the figure, meta, bar and legend lines', () => {
		const { container } = render(DashboardHero, { props: { ...BASE, isLoading: true } });

		expect(screen.getByText('Spent in the last 30 days')).toBeInTheDocument();
		expect(screen.getByRole('combobox', { name: 'Period: 30 days' })).toBeDisabled();
		expect(screen.queryByText('$624.04')).toBeNull();
		expect(screen.getByTestId('dashboard-hero')).toHaveAttribute('aria-busy', 'true');
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
		expect(container.querySelector('.min-h-9.sm\\:min-h-4')).not.toBeNull();
	});

	test('with shared vehicles the running cost says it covers your own', () => {
		const { container } = render(DashboardHero, {
			props: { ...BASE, runningScope: 'on your vehicles' }
		});
		expect(container.textContent?.replace(/\s+/g, ' ')).toContain(
			'$0.21/mi running cost on your vehicles'
		);
	});
});
