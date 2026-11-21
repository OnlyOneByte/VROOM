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
	return screen
		.queryAllByRole('button')
		.filter(b => b.className.includes('hover:bg-accent'))
		.map(b => b.textContent?.trim() ?? '');
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

	test('close shortly after the box loses focus', async () => {
		vi.useFakeTimers();
		try {
			renderTagFilter();
			await fireEvent.focus(tagInput());
			await fireEvent.blur(tagInput());
			expect(suggestionButtons()).not.toHaveLength(0);

			await vi.advanceTimersByTimeAsync(250);

			expect(suggestionButtons()).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('ExpenseTagFilter: adding and removing', () => {
	test('clicking a suggestion appends it to the selection', async () => {
		const { onTagsChange } = renderTagFilter(['tolls']);

		await fireEvent.focus(tagInput());
		await fireEvent.click(screen.getByRole('button', { name: 'parking' }));

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
