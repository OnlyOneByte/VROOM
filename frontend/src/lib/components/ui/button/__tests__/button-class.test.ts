import { render } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import { cn } from '#lib/utils.js';
import Button, { buttonVariants } from '../button.svelte';

function classOf(props: Record<string, unknown>): string {
	const { container, unmount } = render(Button, { props });
	const value = container.querySelector('[data-slot="button"]')?.getAttribute('class') ?? '';
	unmount();
	return value;
}

describe('Button class', () => {
	test('a repeated string class gives the same merged class every time', () => {
		const expected = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'px-1 h-6');

		expect(classOf({ variant: 'ghost', size: 'sm', class: 'px-1 h-6' })).toBe(expected);
		expect(classOf({ variant: 'ghost', size: 'sm', class: 'px-1 h-6' })).toBe(expected);
	});

	test('the same class on another variant merges against that variant', () => {
		expect(classOf({ variant: 'outline', class: 'px-1' })).toBe(
			cn(buttonVariants({ variant: 'outline' }), 'px-1')
		);
		expect(classOf({ variant: 'link', class: 'px-1' })).toBe(
			cn(buttonVariants({ variant: 'link' }), 'px-1')
		);
	});

	test('an array or object class still merges', () => {
		expect(classOf({ class: ['px-1', { 'h-6': true, 'w-6': false }] })).toBe(
			cn(buttonVariants({}), 'px-1', 'h-6')
		);
	});
});
