import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { Car } from '@lucide/svelte';
import StatCard from '../StatCard.svelte';

afterEach(() => cleanup());

function skeletons(container: HTMLElement): Element[] {
	return [...container.querySelectorAll('[data-slot="skeleton"]')];
}

describe('StatCard pads once', () => {
	test.each([false, true])(
		'the Card root drops its py-6 so CardContent owns the padding (loading %s)',
		isLoading => {
			const { container } = render(StatCard, {
				props: { label: 'Total Vehicles', value: '3', icon: Car, isLoading, class: 'min-w-0' }
			});

			const root = container.querySelector('[data-slot="card"]');
			expect(root).toHaveClass('py-0', 'min-w-0');
			expect(root).not.toHaveClass('py-6');
			expect(container.querySelector('[data-slot="card-content"]')).toHaveClass('p-4', 'sm:p-6');
		}
	);
});

describe('StatCard loading tile has the filled tile shape', () => {
	test('with an icon: an icon box, a label line, then the value line', () => {
		const { container } = render(StatCard, {
			props: { label: 'Total Vehicles', value: '', icon: Car, isLoading: true }
		});

		const [iconBox, label, value] = skeletons(container);
		expect(skeletons(container)).toHaveLength(3);
		expect(iconBox).toHaveClass('size-8', 'sm:size-11', 'rounded-xl');
		expect(label).toHaveClass('h-4', 'sm:h-5');
		expect(iconBox?.parentElement).toBe(label?.parentElement);
		expect(iconBox?.parentElement).toHaveClass('flex', 'items-center', 'gap-2');
		expect(value).toHaveClass('h-7', 'sm:h-8', 'mt-2');
	});

	test('the icon box matches the filled tile icon box (p-2 + h-4, p-3 + h-5 from sm)', () => {
		const { container } = render(StatCard, {
			props: { label: 'Total Vehicles', value: '3', icon: Car }
		});

		const box = container.querySelector('svg')?.parentElement;
		expect(box).toHaveClass('p-2', 'sm:p-3');
		expect(container.querySelector('svg')).toHaveClass('h-4', 'sm:h-5');
		expect(container.querySelector('.tabular-nums')).toHaveClass('text-xl', 'sm:text-2xl', 'mt-2');
	});

	test('without an icon: only the label and value lines', () => {
		const { container } = render(StatCard, {
			props: { label: 'Total Vehicles', value: '', isLoading: true }
		});

		const [label, value] = skeletons(container);
		expect(skeletons(container)).toHaveLength(2);
		expect(label).toHaveClass('h-4', 'sm:h-5');
		expect(value).toHaveClass('h-7', 'sm:h-8', 'mt-2');
	});

	test('a unit and a subtitle each keep their line while loading', () => {
		const { container } = render(StatCard, {
			props: {
				label: 'Monthly Average',
				value: '',
				unit: 'last 12 months',
				subtitle: '2 vehicles need attention',
				isLoading: true
			}
		});

		const [, , unit, subtitle] = skeletons(container);
		expect(skeletons(container)).toHaveLength(4);
		expect(unit).toHaveClass('inline-block', 'h-3', 'align-middle');
		expect(subtitle?.parentElement).toHaveClass('relative', 'text-xs', 'mt-1');
		expect(subtitle?.parentElement).toHaveTextContent('2 vehicles need attention');
		expect(subtitle?.previousElementSibling).toHaveClass('invisible');
	});
});
