import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseActionBar from '../ExpenseActionBar.svelte';

afterEach(() => cleanup());

function mount() {
	const onSave = vi.fn();
	const { container } = render(ExpenseActionBar, {
		props: {
			isEditMode: true,
			canDuplicate: true,
			isSubmitting: false,
			isDeleting: false,
			onDelete: vi.fn(),
			onDuplicate: vi.fn(),
			onCancel: vi.fn(),
			onSave
		}
	});
	return { container, onSave };
}

describe('ExpenseActionBar', () => {
	test('is a fixed bar below lg and a normal row from lg or on a short viewport', () => {
		const { container } = mount();
		expect(container.firstElementChild).toHaveClass('fixed', 'lg:static', 'short:static');
	});

	test('Save is the plain primary button, not a foreground slab with a heavy shadow', () => {
		mount();
		const save = screen.getByRole('button', { name: 'Update Expense' });
		expect(save).toHaveClass('shadow-sm', 'transition-colors');
		expect(save.className).not.toMatch(/shadow-2xl|bg-foreground|hover:scale/);
	});

	test('pressing a button does not blur the field being edited, so blur validation cannot move the row mid-click', async () => {
		const { onSave } = mount();
		for (const name of ['Delete', 'Duplicate', 'Cancel', 'Update Expense']) {
			const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
			screen.getByRole('button', { name }).dispatchEvent(press);
			expect(press.defaultPrevented, name).toBe(true);
		}
		await fireEvent.click(screen.getByRole('button', { name: 'Update Expense' }));
		expect(onSave).toHaveBeenCalledOnce();
	});
});
