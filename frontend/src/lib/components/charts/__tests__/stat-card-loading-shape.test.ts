import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { Car } from '@lucide/svelte';
import StatCard from '../StatCard.svelte';

afterEach(() => cleanup());

function skeletons(container: HTMLElement): Element[] {
	return [...container.querySelectorAll('[data-slot="skeleton"]')];
}

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
});
