import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseCategoryFilter from '../ExpenseCategoryFilter.svelte';

function renderFilter(value: string, density: 'compact' | 'table') {
	const onChange = vi.fn();
	render(ExpenseCategoryFilter, { value, onChange, density });
	return { onChange, trigger: screen.getByLabelText('Category filter') };
}

async function open(trigger: HTMLElement): Promise<void> {
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
}

async function choose(name: string): Promise<void> {
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('ExpenseCategoryFilter', () => {
	test.each(['compact', 'table'] as const)(
		'shows a generic Category label with no selection in %s density',
		density => {
			const { trigger } = renderFilter('', density);

			expect(trigger).toHaveTextContent(/^\s*Category\s*$/);
		}
	);

	test('compact density uses the smaller text style', () => {
		const { trigger } = renderFilter('', 'compact');

		expect(trigger.className).toContain('text-xs');
		expect(trigger.className).not.toContain('-ml-2');
	});

	test('table density uses the offset style', () => {
		const { trigger } = renderFilter('', 'table');

		expect(trigger.className).toContain('-ml-2');
	});

	test.each(['compact', 'table'] as const)(
		'shows the selected category label in %s density',
		density => {
			const { trigger } = renderFilter('maintenance', density);

			expect(trigger).toHaveTextContent('Maintenance');
		}
	);

	test('offers All categories plus every category', async () => {
		const { trigger } = renderFilter('', 'table');

		await open(trigger);
		await screen.findByRole('option', { name: 'All categories' });

		expect(screen.getAllByRole('option').map(o => o.textContent?.trim())).toEqual([
			'All categories',
			'Fuel & charging',
			'Maintenance',
			'Financial',
			'Regulatory',
			'Enhancement',
			'Misc'
		]);
	});

	test('choosing a category reports its key', async () => {
		const { trigger, onChange } = renderFilter('', 'table');

		await open(trigger);
		await choose('Regulatory');

		expect(onChange).toHaveBeenCalledWith('regulatory');
	});

	test('choosing All categories clears the filter', async () => {
		const { trigger, onChange } = renderFilter('fuel', 'compact');

		await open(trigger);
		await choose('All categories');

		expect(onChange).toHaveBeenCalledWith('');
	});
});
