import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Segmented from '../Segmented.svelte';

const options = [
	{ value: 'a', label: 'Alpha' },
	{ value: 'b', label: 'Bravo' },
	{ value: 'c', label: 'Charlie' }
] as const;

afterEach(() => {
	cleanup();
});

describe('Segmented', () => {
	test('is a named radio group with the value checked and only it in the tab order', () => {
		render(Segmented, { props: { label: 'Letters', value: 'b', options } });

		expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
		const radios = screen.getAllByRole('radio');
		expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		expect(radios.map(r => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
	});

	test('reports a new choice once, and none for the current one', async () => {
		const onValueChange = vi.fn();
		render(Segmented, { props: { label: 'Letters', value: 'a', options, onValueChange } });

		await fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
		expect(onValueChange).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith('c');
	});

	test('shows what the parent holds, so an ignored change does not stick', async () => {
		render(Segmented, {
			props: { label: 'Letters', value: 'a', options, onValueChange: () => {} }
		});

		await fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));

		expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: 'Bravo' })).toHaveAttribute('aria-checked', 'false');
	});

	test('the arrow key moves to the next option and chooses it', async () => {
		const onValueChange = vi.fn();
		render(Segmented, { props: { label: 'Letters', value: 'a', options, onValueChange } });
		const alpha = screen.getByRole('radio', { name: 'Alpha' });
		alpha.focus();

		await fireEvent.keyDown(alpha, { key: 'ArrowRight' });

		expect(screen.getByRole('radio', { name: 'Bravo' })).toHaveFocus();
		expect(onValueChange).toHaveBeenCalledWith('b');
	});
});
