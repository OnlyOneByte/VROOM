import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import StatCard from '../StatCard.svelte';

afterEach(() => cleanup());

function changeLine(percent: number, goodWhen: 'up' | 'down') {
	render(StatCard, {
		props: { label: 'Cost', value: '$1', change: { percent, goodWhen, label: 'vs before' } }
	});
	const line = screen.getByText('vs before', { exact: false }).closest('p') as HTMLElement;
	return { text: line.textContent?.replace(/\s+/g, ' ').trim(), icon: line.querySelector('svg') };
}

describe('StatCard change line', () => {
	test('a rise where lower is better tints only the icon as bad', () => {
		const { text, icon } = changeLine(12, 'down');
		expect(text).toBe('+12% vs before');
		expect(icon).toHaveClass('text-destructive');
		expect(icon).toHaveAttribute('aria-hidden', 'true');
	});

	test('a fall where lower is better is good', () => {
		const { text, icon } = changeLine(-5, 'down');
		expect(text).toBe('-5% vs before');
		expect(icon).toHaveClass('text-chart-2');
	});

	test('no change is neutral', () => {
		const { text, icon } = changeLine(0, 'up');
		expect(text).toBe('0% vs before');
		expect(icon).toHaveClass('text-muted-foreground');
	});

	test('no change prop draws no line', () => {
		render(StatCard, { props: { label: 'Cost', value: '$1' } });
		expect(screen.queryByText('vs', { exact: false })).toBeNull();
	});
});
