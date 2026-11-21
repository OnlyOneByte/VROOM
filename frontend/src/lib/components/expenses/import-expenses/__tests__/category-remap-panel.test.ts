import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { ExpenseCategory } from '#lib/types/index.ts';
import CategoryRemapPanel from '../CategoryRemapPanel.svelte';

function renderPanel(
	unmappedCategories: string[],
	categoryRemap: Record<string, ExpenseCategory> = {}
) {
	const onRemap = vi.fn();
	const view = render(CategoryRemapPanel, { unmappedCategories, categoryRemap, onRemap });
	return { ...view, onRemap };
}

describe('CategoryRemapPanel', () => {
	test('renders nothing when every category was recognized', () => {
		const { container } = renderPanel([]);

		expect(container.textContent?.trim()).toBe('');
	});

	test('lists each unrecognized word with a Misc default', () => {
		renderPanel(['gas', 'insurance']);

		expect(screen.getByText('Unrecognized categories')).toBeInTheDocument();
		expect(screen.getByTestId('remap-category-gas')).toHaveTextContent('Map to… (Misc)');
		expect(screen.getByTestId('remap-category-insurance')).toHaveTextContent('Map to… (Misc)');
	});

	test('shows the label of an already-mapped word', () => {
		renderPanel(['gas', 'insurance'], { gas: 'fuel' });

		expect(screen.getByTestId('remap-category-gas')).toHaveTextContent('Fuel & Charging');
		expect(screen.getByTestId('remap-category-insurance')).toHaveTextContent('Map to… (Misc)');
	});

	test('choosing a category reports the word and category key', async () => {
		const { onRemap } = renderPanel(['oil change']);
		const trigger = screen.getByLabelText('Category for oil change');

		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);

		expect(onRemap).toHaveBeenCalledWith('oil change', 'maintenance');
	});
});
