import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TagInput from '../TagInput.svelte';

const SUGGESTIONS = ['fuel', 'tolls', 'parking', 'road-trip'] as const;

function renderTagInput(
	tags: string[] = [],
	extra: { error?: string; touched?: boolean; suggestions?: readonly string[] } = {}
) {
	render(TagInput, { tags, suggestions: SUGGESTIONS, ...extra });
	return screen.getByLabelText('Tags (optional)') as HTMLInputElement;
}

function selectedTags(): string[] {
	return screen
		.queryAllByRole('button', { name: /^Remove .* tag$/ })
		.map(b => b.getAttribute('aria-label')?.replace(/^Remove (.*) tag$/, '$1') ?? '');
}

function suggestionButtons(): string[] {
	return screen.queryAllByRole('option').map(b => b.textContent?.trim() ?? '');
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
		await fireEvent.click(screen.getByRole('option', { name: 'road-trip' }));

		expect(selectedTags()).toEqual(['road-trip']);
		expect(suggestionButtons()).not.toContain('road-trip');
	});

	test('show at most eight', async () => {
		const many = Array.from({ length: 12 }, (_, i) => `tag${i}`);
		const input = renderTagInput([], { suggestions: many });

		await fireEvent.focus(input);

		expect(suggestionButtons()).toHaveLength(8);
	});

	test('hide as soon as focus leaves the field', async () => {
		const input = renderTagInput();
		const outside = document.createElement('button');
		document.body.append(outside);
		await fireEvent.focus(input);
		expect(suggestionButtons()).not.toHaveLength(0);

		await fireEvent.focusOut(input, { relatedTarget: outside });

		expect(suggestionButtons()).toEqual([]);
		outside.remove();
	});

	test('pressing a suggestion keeps focus in the box', async () => {
		const input = renderTagInput();
		await fireEvent.focus(input);

		const pressed = await fireEvent.mouseDown(screen.getByRole('option', { name: 'fuel' }));

		expect(pressed).toBe(false);
	});
});

describe('TagInput: keyboard', () => {
	test('the box is a combobox and the suggestions are not tab stops', async () => {
		const input = renderTagInput();
		expect(input).toHaveAttribute('role', 'combobox');
		expect(input).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.focus(input);

		expect(input).toHaveAttribute('aria-expanded', 'true');
		expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
		expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '-1');
		for (const option of screen.getAllByRole('option')) {
			expect(option).toHaveAttribute('tabindex', '-1');
		}
	});

	test('ArrowDown then Enter adds the active suggestion', async () => {
		const input = renderTagInput();
		await fireEvent.focus(input);

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		const active = screen.getByRole('option', { name: 'tolls' });
		expect(active).toHaveAttribute('aria-selected', 'true');
		expect(input).toHaveAttribute('aria-activedescendant', active.id);

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(selectedTags()).toEqual(['tolls']);
		expect(input).not.toHaveAttribute('aria-activedescendant');
	});

	test('ArrowUp wraps to the last suggestion', async () => {
		const input = renderTagInput();
		await fireEvent.focus(input);

		await fireEvent.keyDown(input, { key: 'ArrowUp' });

		expect(screen.getByRole('option', { name: 'road-trip' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});

	test('Escape closes the list without leaving the box', async () => {
		const input = renderTagInput();
		await fireEvent.focus(input);

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(suggestionButtons()).toEqual([]);
		expect(input).toHaveAttribute('aria-expanded', 'false');
	});

	test('Escape stays inside the field while the list is open, and passes on once it is closed', async () => {
		const input = renderTagInput();
		const pageKeydown = vi.fn();
		document.addEventListener('keydown', pageKeydown);
		await fireEvent.focus(input);

		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(pageKeydown).not.toHaveBeenCalled();

		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(pageKeydown).toHaveBeenCalledTimes(1);
		document.removeEventListener('keydown', pageKeydown);
	});

	test('typing after Escape opens the list again', async () => {
		const input = renderTagInput();
		await fireEvent.focus(input);
		await fireEvent.keyDown(input, { key: 'Escape' });

		await fireEvent.input(input, { target: { value: 'par' } });

		expect(suggestionButtons()).toEqual(['parking']);
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
	test('the box looks and focuses like every other input', () => {
		const input = renderTagInput();
		const box = input.closest('.min-h-11\\.5');

		for (const cls of [
			'bg-surface',
			'border-[1.5px]',
			'border-border-strong',
			'rounded-[var(--r-md)]',
			'focus-within:border-foreground',
			'focus-within:ring-[3px]',
			'focus-within:ring-ring/50'
		]) {
			expect(box?.classList).toContain(cls);
		}
		expect(box?.classList).not.toContain('bg-background');
	});
});

describe('TagInput: chip focus', () => {
	test("a chip's remove button shows a high-contrast foreground ring of its own", () => {
		renderTagInput(['fuel']);
		const remove = screen.getByRole('button', { name: 'Remove fuel tag' });

		for (const cls of [
			'rounded-full',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-foreground'
		]) {
			expect(remove).toHaveClass(cls);
		}
	});
});
