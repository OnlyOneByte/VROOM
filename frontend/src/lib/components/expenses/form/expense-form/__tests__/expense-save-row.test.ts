import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ExpenseSaveRow from '../ExpenseSaveRow.svelte';

afterEach(() => cleanup());

describe('ExpenseSaveRow Cancel', () => {
	test.each([true, false])(
		'Cancel is the quiet outline button, never the accent link (quick: %s)',
		quick => {
			const onCancel = vi.fn();
			render(ExpenseSaveRow, { props: { isSubmitting: false, onCancel, quick } });

			const cancel = screen.getByRole('button', { name: 'Cancel' });
			expect(cancel).toHaveClass('border-border-strong');
			expect(cancel).not.toHaveClass('text-accent-ink');
			cancel.click();
			expect(onCancel).toHaveBeenCalledTimes(1);
		}
	);
});
