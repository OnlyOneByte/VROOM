import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import CategorySelector from '../CategorySelector.svelte';

describe('CategorySelector icons', () => {
	test('every tile icon keeps its size next to a long label', () => {
		const { container } = render(CategorySelector, { props: { value: '', onSelect: () => {} } });
		const icons = container.querySelectorAll('button svg');
		expect(icons).toHaveLength(6);
		for (const icon of icons) expect(icon.classList.contains('shrink-0')).toBe(true);
	});
});
