import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TagInput from '../TagInput.svelte';

const SUGGESTIONS = ['fuel', 'tolls', 'parking', 'road-trip'] as const;

function renderTagInput(
	tags: string[] = [],
	extra: { error?: string; touched?: boolean; suggestions?: readonly string[] } = {}
) {
	render(TagInput, { tags, suggestions: SUGGESTIONS, ...extra });
	return screen.getByLabelText('Tags (Optional)') as HTMLInputElement;
}

function selectedTags(): string[] {
	return screen
		.queryAllByRole('button', { name: /^Remove .* tag$/ })
		.map(b => b.getAttribute('aria-label')?.replace(/^Remove (.*) tag$/, '$1') ?? '');
}

function suggestionButtons(): string[] {
	return screen
		.queryAllByRole('button')
		.filter(b => b.className.includes('text-left'))
		.map(b => b.textContent?.trim() ?? '');
}

async function typeAndEnter(input: HTMLInputElement, value: string): Promise<void> {
	await fireEvent.input(input, { target: { value } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

afterEach(() => {
	vi.useRealTimers();
});

describe('TagInput: adding tags', () => {
	test('Enter adds the typed tag trimmed and lower-cased, then clears the box', async () => {
		const input = renderTagInput();

		await typeAndEnter(input, '  Road Trip ');

		expect(selectedTags()).toEqual(['road trip']);
		expect(input.value).toBe('');
	});

	test('Enter on a blank box adds nothing', async () => {
		const input = renderTagInput();

		await typeAndEnter(input, '   ');

		expect(selectedTags()).toEqual([]);
	});

	test('a duplicate tag is ignored regardless of case and stays in the box', async () => {
		const input = renderTagInput(['tolls']);

		await typeAndEnter(input, 'TOLLS');

		expect(selectedTags()).toEqual(['tolls']);
		expect(input.value).toBe('TOLLS');
	});

	test('no more than ten tags can be added', async () => {
		const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
		const input = renderTagInput(ten);

		await typeAndEnter(input, 'eleventh');

		expect(selectedTags()).toHaveLength(10);
		expect(selectedTags()).not.toContain('eleventh');
	});

	test('the placeholder shows only while there are no tags', async () => {
		const input = renderTagInput();
		expect(input.placeholder).toBe('Add tags (e.g., fuel, maintenance)');

		await typeAndEnter(input, 'fuel');

		expect(input.placeholder).toBe('');
	});
});

describe('TagInput: removing tags', () => {
	test('the remove button drops that tag', async () => {
		renderTagInput(['fuel', 'tolls', 'parking']);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove tolls tag' }));

		expect(selectedTags()).toEqual(['fuel', 'parking']);
	});

	test('Backspace in an empty box drops the last tag', async () => {
		const input = renderTagInput(['fuel', 'tolls']);

		await fireEvent.keyDown(input, { key: 'Backspace' });

		expect(selectedTags()).toEqual(['fuel']);
	});

	test('Backspace while typing leaves tags alone', async () => {
		const input = renderTagInput(['fuel']);

		await fireEvent.input(input, { target: { value: 'x' } });
		await fireEvent.keyDown(input, { key: 'Backspace' });

		expect(selectedTags()).toEqual(['fuel']);
	});

	test('other keys do nothing', async () => {
		const input = renderTagInput(['fuel']);

		await fireEvent.keyDown(input, { key: 'Tab' });

		expect(selectedTags()).toEqual(['fuel']);
	});
});

describe('TagInput: suggestions', () => {
	test('appear on focus excluding tags already chosen', async () => {
		const input = renderTagInput(['tolls']);
		expect(suggestionButtons()).toEqual([]);

		await fireEvent.focus(input);

		expect(suggestionButtons()).toEqual(['fuel', 'parking', 'road-trip']);
	});

	test('filter by the typed text case-insensitively', async () => {
		const input = renderTagInput();

		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'PAR' } });

		expect(suggestionButtons()).toEqual(['parking']);
	});

	test('clicking a suggestion adds it', async () => {
		const input = renderTagInput();

		await fireEvent.focus(input);
		await fireEvent.click(screen.getByRole('button', { name: 'road-trip' }));

		expect(selectedTags()).toEqual(['road-trip']);
		expect(suggestionButtons()).not.toContain('road-trip');
	});

	test('show at most eight', async () => {
		const many = Array.from({ length: 12 }, (_, i) => `tag${i}`);
		const input = renderTagInput([], { suggestions: many });

		await fireEvent.focus(input);

		expect(suggestionButtons()).toHaveLength(8);
	});

	test('hide shortly after the box loses focus', async () => {
		vi.useFakeTimers();
		const input = renderTagInput();
		await fireEvent.focus(input);
		await fireEvent.blur(input);
		expect(suggestionButtons()).not.toHaveLength(0);

		await vi.advanceTimersByTimeAsync(250);

		expect(suggestionButtons()).toEqual([]);
	});
});

describe('TagInput: errors', () => {
	test('an error shows only once the field is touched', () => {
		const input = renderTagInput([], { error: 'Too many tags', touched: false });

		expect(screen.queryByText('Too many tags')).toBeNull();
		expect(input).not.toHaveAttribute('aria-describedby');
	});

	test('a touched error is shown and linked to the input', () => {
		const input = renderTagInput([], { error: 'Too many tags', touched: true });

		expect(screen.getByText('Too many tags')).toBeInTheDocument();
		expect(input).toHaveAttribute('aria-describedby', 'tags-error');
	});
});

describe('TagInput: focus', () => {
	test('the bordered box shows a ring while the input has focus', () => {
		const input = renderTagInput();
		const box = input.closest('.border');

		for (const cls of [
			'focus-within:ring-2',
			'focus-within:ring-ring',
			'focus-within:ring-offset-2',
			'ring-offset-background'
		]) {
			expect(box?.className).toContain(cls);
		}
	});
});
