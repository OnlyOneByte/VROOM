import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CategorySelector from '../CategorySelector.svelte';

function mount(
	props: { value?: string; error?: string; touched?: boolean; disabledValues?: string[] } = {}
) {
	const onSelect = vi.fn();
	const view = render(CategorySelector, { props: { value: '', ...props, onSelect } });
	return { ...view, onSelect };
}

function radio(name: string): HTMLElement {
	return screen.getByRole('radio', { name });
}

describe('CategorySelector radio group', () => {
	test('is one labelled radio group with a single tab stop', () => {
		mount();
		const group = screen.getByRole('radiogroup', { name: 'Category *' });
		const radios = screen.getAllByRole('radio');
		expect(group).toBeInTheDocument();
		expect(radios).toHaveLength(6);
		expect(radios.filter(item => item.tabIndex === 0)).toHaveLength(1);
	});

	test('each chip carries its category description', () => {
		mount();
		expect(radio('Fuel')).toHaveAccessibleDescription('Gas, diesel, and EV charging');
	});

	test('with nothing chosen, arrows move focus without choosing and Space chooses', async () => {
		const { onSelect } = mount();
		radio('Fuel').focus();

		await fireEvent.keyDown(radio('Fuel'), { key: 'ArrowRight' });

		expect(document.activeElement).toBe(radio('Maintenance'));
		expect(onSelect).not.toHaveBeenCalled();
		await fireEvent.keyDown(radio('Maintenance'), { key: ' ' });
		expect(onSelect).toHaveBeenCalledWith('maintenance');
	});

	test('with a category chosen, arrows move to and choose the next one', async () => {
		const { onSelect } = mount({ value: 'fuel' });
		expect(radio('Fuel')).toHaveAttribute('aria-checked', 'true');
		radio('Fuel').focus();

		await fireEvent.keyDown(radio('Fuel'), { key: 'ArrowDown' });

		expect(onSelect).toHaveBeenCalledWith('maintenance');
	});

	test('a touched error marks the group invalid and describes it', () => {
		mount({ error: 'Please select a category', touched: true });
		const group = screen.getByRole('radiogroup', { name: 'Category *' });
		expect(group).toHaveAttribute('aria-invalid', 'true');
		expect(group).toHaveAccessibleDescription('Please select a category');
	});

	test('a disabled category cannot be chosen', async () => {
		const { onSelect } = mount({ disabledValues: ['fuel'] });
		expect(radio('Fuel')).toBeDisabled();
		await fireEvent.click(radio('Fuel'));
		expect(onSelect).not.toHaveBeenCalled();
	});
});
