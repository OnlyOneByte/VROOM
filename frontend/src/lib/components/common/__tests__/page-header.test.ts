import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import PageHeader from '../page-header.svelte';

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

describe('the shared page header', () => {
	test('renders one h1 at the page-title size with a text description', () => {
		const { getAllByRole, getByText } = render(PageHeader, {
			title: 'Settings',
			description: 'Manage your preferences and data'
		});

		const headings = getAllByRole('heading', { level: 1 });
		expect(headings).toHaveLength(1);
		expect(headings[0]).toHaveTextContent('Settings');
		expect(headings[0]).toHaveClass('text-3xl', 'font-bold', 'tracking-tight');
		expect(getByText('Manage your preferences and data')).toBeInTheDocument();
	});

	test('renders a back control before the title and a snippet description', () => {
		const { getByRole, getByText } = render(PageHeader, {
			title: 'Add Expense',
			description: html('<span>Track a new vehicle expense</span>'),
			back: html('<button aria-label="Go back">←</button>')
		});

		const back = getByRole('button', { name: 'Go back' });
		const title = getByRole('heading', { level: 1, name: 'Add Expense' });
		expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(getByText('Track a new vehicle expense')).toBeInTheDocument();
	});

	test('the title keeps whole words: actions wrap below it instead of squeezing it from sm: up', () => {
		const { getByRole } = render(PageHeader, {
			title: 'All Expenses',
			actions: html('<button>Add Expense</button>')
		});

		const titleBlock = getByRole('heading', { level: 1 }).parentElement?.parentElement;
		expect(titleBlock).toHaveClass('min-w-0', 'sm:grow', 'sm:basis-[min-content]');
		expect(titleBlock?.parentElement).toHaveClass('sm:flex-row', 'sm:flex-wrap');
	});

	test('a short, narrow viewport drops the description so the actions stay on the first screen', () => {
		const { getByText } = render(PageHeader, {
			title: 'All Expenses',
			description: '10,000 expenses across 5 vehicles'
		});

		expect(getByText('10,000 expenses across 5 vehicles')).toHaveClass('max-sm:short:hidden');
	});
});
