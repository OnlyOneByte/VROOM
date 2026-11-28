import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { VehicleFinancing } from '#lib/types/index.ts';
import {
	calculateAmortizationSchedule,
	type AmortizationEntry
} from '#lib/utils/financing-calculations.ts';
import { makeLease, makeLoan } from './financing-fixtures';

interface ChartRow {
	paymentNumber: number;
	principal: number;
	interest: number;
	isPaid: boolean;
	remainingBalance: number;
}

interface CapturedChartProps {
	data: ChartRow[];
	x: string;
	y?: string[];
	seriesLayout?: string;
	series: Array<{ key: string }>;
	props: { xAxis: { ticks: number; format: (v: number) => string } };
}

const gate = vi.hoisted(() => ({ visible: true }));
const captured = vi.hoisted(() => ({ props: null as CapturedChartProps | null }));

vi.mock('#lib/utils/visibility-watch.svelte.ts', () => ({
	createVisibilityWatch: () => ({
		el: undefined,
		get visible() {
			return gate.visible;
		}
	})
}));

vi.mock('layerchart', () => ({
	BarChart: (_anchor: unknown, props: CapturedChartProps) => {
		captured.props = props;
	},
	getChartContext: () => ({}),
	Tooltip: {}
}));

import FinancingCharts from '../FinancingCharts.svelte';

function mount(financing: VehicleFinancing, amortizationSchedule?: AmortizationEntry[]) {
	return render(FinancingCharts, { props: { financing, amortizationSchedule } });
}

function longSchedule(length: number): AmortizationEntry[] {
	return Array.from({ length }, (_, i) => ({
		paymentNumber: i + 1,
		paymentDate: new Date(2020, i, 1),
		paymentAmount: 500,
		principalAmount: 400 + i,
		interestAmount: 100 - i / 10,
		remainingBalance: 100_000 - i * 400,
		isPaid: i < 10
	}));
}

beforeEach(() => {
	gate.visible = true;
	captured.props = null;
});

afterEach(() => {
	cleanup();
});

describe('FinancingCharts', () => {
	test('charts the principal and interest of every scheduled payment for a loan with APR', () => {
		const financing = makeLoan({
			originalAmount: 2_000,
			apr: 12,
			paymentAmount: 500,
			termMonths: 12
		});
		const schedule = calculateAmortizationSchedule(financing, 2);
		mount(financing, schedule);
		expect(screen.getByText('Payment schedule')).toBeTruthy();
		expect(screen.getByText(/with 5 payments/)).toBeTruthy();
		expect(captured.props?.x).toBe('paymentNumber');
		expect(captured.props?.seriesLayout).toBe('stack');
		expect(captured.props?.series.map(s => s.key)).toEqual(['principal', 'interest']);
		expect(captured.props?.y).toBeUndefined();
		const rows = captured.props!.data;
		expect(rows.map(r => r.paymentNumber)).toEqual([1, 2, 3, 4, 5]);
		expect(rows[0]).toMatchObject({ principal: 480, interest: 20, isPaid: true });
		expect(rows[2]?.isPaid).toBe(false);
		expect(rows[4]?.remainingBalance).toBe(0);
		expect(captured.props!.props.xAxis.ticks).toBe(5);
		expect(captured.props!.props.xAxis.format(3)).toBe('#3');
	});

	test('samples long schedules down to about 100 bars and always keeps the final payment', () => {
		mount(makeLoan(), longSchedule(201));
		const rows = captured.props!.data;
		expect(rows).toHaveLength(68);
		expect(rows[0]?.paymentNumber).toBe(1);
		expect(rows[1]?.paymentNumber).toBe(4);
		expect(rows.at(-2)?.paymentNumber).toBe(199);
		expect(rows.at(-1)?.paymentNumber).toBe(201);
		expect(captured.props!.props.xAxis.ticks).toBe(8);
		expect(screen.getByText(/with 201 payments/)).toBeTruthy();
	});

	test('does not duplicate the final payment when sampling already lands on it', () => {
		mount(makeLoan(), longSchedule(250));
		const numbers = captured.props!.data.map(r => r.paymentNumber);
		expect(numbers).toHaveLength(84);
		expect(numbers.at(-1)).toBe(250);
		expect(numbers.filter(n => n === 250)).toHaveLength(1);
	});

	test('keeps the card but defers the chart until it scrolls into view', () => {
		gate.visible = false;
		mount(makeLoan(), longSchedule(12));
		expect(screen.getByText('Payment schedule')).toBeTruthy();
		expect(captured.props).toBeNull();
	});

	test.each<[string, VehicleFinancing, AmortizationEntry[] | undefined]>([
		['a zero-APR loan', makeLoan({ apr: 0 }), longSchedule(12)],
		['a lease', makeLease(), longSchedule(12)],
		['an empty schedule', makeLoan(), []],
		['no schedule', makeLoan(), undefined]
	])('renders nothing for %s', (_label, financing, schedule) => {
		mount(financing, schedule);
		expect(screen.queryByText('Payment schedule')).toBeNull();
		expect(captured.props).toBeNull();
	});
});
