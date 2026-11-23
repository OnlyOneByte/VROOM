import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseTagFilter from '../ExpenseTagFilter.svelte';

const ALL_TAGS = ['Commute', 'parking', 'road-trip', 'tolls'];

function renderTagFilter(selectedTags: string[] = []) {
	const onTagsChange = vi.fn();
	const view = render(ExpenseTagFilter, {
		allTags: ALL_TAGS,
		selectedTags,
		onTagsChange
	});
	return { ...view, onTagsChange };
}

function tagInput(): HTMLInputElement {
	return screen.getByLabelText('Search tags') as HTMLInputElement;
}

function suggestionButtons(): string[] {
	return screen.queryAllByRole('option').map(b => b.textContent?.trim() ?? '');
}

describe('ExpenseTagFilter: suggestions', () => {
	test('stay hidden until the box is focused', () => {
		renderTagFilter();

		expect(suggestionButtons()).toHaveLength(0);
	});

	test('list every tag not already selected', async () => {
		renderTagFilter(['tolls']);

		await fireEvent.focus(tagInput());

		expect(suggestionButtons()).toEqual(['Commute', 'parking', 'road-trip']);
	});

	test('narrow case-insensitively as the user types', async () => {
		renderTagFilter();

		await fireEvent.focus(tagInput());
		await fireEvent.input(tagInput(), { target: { value: 'ROAD' } });

		expect(suggestionButtons()).toEqual(['road-trip']);
	});

	test('treat a whitespace-only term as no filter', async () => {
		renderTagFilter();

		await fireEvent.focus(tagInput());
		await fireEvent.input(tagInput(), { target: { value: '   ' } });

		expect(suggestionButtons()).toHaveLength(ALL_TAGS.length);
	});

	test('close when Escape is pressed', async () => {
		renderTagFilter();

		await fireEvent.focus(tagInput());
		await fireEvent.keyDown(tagInput(), { key: 'Escape' });

		expect(suggestionButtons()).toHaveLength(0);
	});

	test('close as soon as focus leaves the field', async () => {
		renderTagFilter();
		const outside = document.createElement('button');
		document.body.append(outside);
		await fireEvent.focus(tagInput());
		expect(suggestionButtons()).not.toHaveLength(0);

		await fireEvent.focusOut(tagInput(), { relatedTarget: outside });

		expect(suggestionButtons()).toHaveLength(0);
		outside.remove();
	});
});

describe('ExpenseTagFilter: keyboard', () => {
	test('suggestions are listbox options outside the tab order', async () => {
		renderTagFilter();

		await fireEvent.focus(tagInput());

		expect(tagInput()).toHaveAttribute('role', 'combobox');
		expect(tagInput()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
		expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '-1');
		for (const option of screen.getAllByRole('option')) {
			expect(option).toHaveAttribute('tabindex', '-1');
		}
	});

	test('ArrowDown then Enter adds the active suggestion', async () => {
		const { onTagsChange } = renderTagFilter();
		await fireEvent.focus(tagInput());

		await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' });
		await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' });
		expect(tagInput()).toHaveAttribute(
			'aria-activedescendant',
			screen.getByRole('option', { name: 'parking' }).id
		);
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(onTagsChange).toHaveBeenCalledWith(['parking']);
	});

	test('ArrowUp wraps to the last suggestion', async () => {
		renderTagFilter();
		await fireEvent.focus(tagInput());

		await fireEvent.keyDown(tagInput(), { key: 'ArrowUp' });

		expect(screen.getByRole('option', { name: 'tolls' })).toHaveAttribute('aria-selected', 'true');
	});

	test('Escape stays inside the field while the list is open, and passes on once it is closed', async () => {
		renderTagFilter();
		const pageKeydown = vi.fn();
		document.addEventListener('keydown', pageKeydown);
		await fireEvent.focus(tagInput());

		await fireEvent.keyDown(tagInput(), { key: 'Escape' });
		expect(pageKeydown).not.toHaveBeenCalled();
		expect(tagInput()).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.keyDown(tagInput(), { key: 'Escape' });
		expect(pageKeydown).toHaveBeenCalledTimes(1);
		document.removeEventListener('keydown', pageKeydown);
	});

	test('typing after Escape opens the list again, so Enter never adds a hidden tag', async () => {
		renderTagFilter();
		await fireEvent.focus(tagInput());
		await fireEvent.keyDown(tagInput(), { key: 'Escape' });

		await fireEvent.input(tagInput(), { target: { value: 'ol' } });

		expect(suggestionButtons()).toEqual(['tolls']);
	});

	test('pressing a suggestion keeps focus in the box', async () => {
		renderTagFilter();
		await fireEvent.focus(tagInput());

		const pressed = await fireEvent.mouseDown(screen.getByRole('option', { name: 'tolls' }));

		expect(pressed).toBe(false);
	});

	test('two filters on one page get distinct list ids', async () => {
		renderTagFilter();
		renderTagFilter();
		const [first, second] = screen.getAllByLabelText('Search tags');
		if (!first || !second) throw new Error('expected two tag filters');

		await fireEvent.focus(first);
		const firstList = first.getAttribute('aria-controls');
		await fireEvent.focus(second);

		expect(firstList).toBeTruthy();
		expect(second.getAttribute('aria-controls')).not.toBe(firstList);
	});
});

describe('ExpenseTagFilter: adding and removing', () => {
	test('clicking a suggestion appends it to the selection', async () => {
		const { onTagsChange } = renderTagFilter(['tolls']);

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('option', { name: 'parking' }));

		expect(onTagsChange).toHaveBeenCalledWith(['tolls', 'parking']);
	});

	test('Enter prefers the exact case-insensitive match', async () => {
		const { onTagsChange } = renderTagFilter();

		await fireEvent.input(tagInput(), { target: { value: ' commute ' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(onTagsChange).toHaveBeenCalledWith(['Commute']);
		expect(tagInput().value).toBe('');
	});

	test('Enter falls back to the first matching suggestion', async () => {
		const { onTagsChange } = renderTagFilter();

		await fireEvent.input(tagInput(), { target: { value: 'ol' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(onTagsChange).toHaveBeenCalledWith(['tolls']);
	});

	test('Enter with no match changes nothing', async () => {
		const { onTagsChange } = renderTagFilter();

		await fireEvent.input(tagInput(), { target: { value: 'zzz' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		expect(onTagsChange).not.toHaveBeenCalled();
	});

	test('Backspace in an empty box drops the last selected tag', async () => {
		const { onTagsChange } = renderTagFilter(['tolls', 'parking']);

		await fireEvent.keyDown(tagInput(), { key: 'Backspace' });

		expect(onTagsChange).toHaveBeenCalledWith(['tolls']);
	});

	test('Backspace does nothing with no tags selected or text in the box', async () => {
		const { onTagsChange } = renderTagFilter();
		await fireEvent.keyDown(tagInput(), { key: 'Backspace' });
		expect(onTagsChange).not.toHaveBeenCalled();
	});

	test('the remove button drops just that tag', async () => {
		const { onTagsChange } = renderTagFilter(['tolls', 'parking', 'Commute']);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove tag parking' }));

		expect(onTagsChange).toHaveBeenCalledWith(['tolls', 'Commute']);
	});

	test('the placeholder invites adding more once a tag is selected', () => {
		renderTagFilter(['tolls']);

		expect(tagInput().placeholder).toBe('Add more tags...');
	});
});

describe('ExpenseTagFilter: match mode', () => {
	test('offers no Any/All switch, because the list always requires every selected tag', async () => {
		const { rerender } = renderTagFilter(['tolls']);
		expect(screen.queryByText('Matching all selected tags')).toBeNull();

		await rerender({ selectedTags: ['tolls', 'parking'] });

		expect(screen.queryByRole('radiogroup')).toBeNull();
		expect(screen.queryByRole('radio', { name: 'Any' })).toBeNull();
		expect(screen.getByText('Matching all selected tags')).toBeInTheDocument();
	});
});

describe('ExpenseTagFilter: chip focus', () => {
	test("a chip's remove button shows a high-contrast foreground ring of its own", () => {
		renderTagFilter(['tolls']);
		const remove = screen.getByRole('button', { name: 'Remove tag tolls' });

		for (const cls of [
			'rounded-full',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-foreground'
		]) {
			expect(remove).toHaveClass(cls);
		}
	});
});
