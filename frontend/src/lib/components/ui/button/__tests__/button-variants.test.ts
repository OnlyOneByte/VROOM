import { describe, expect, test } from 'vitest';
import { buttonVariants } from '../button.svelte';

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;

describe('Button invalid border', () => {
	test.each(VARIANTS)('%s keeps the destructive border when invalid in dark mode', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);
		const darkBorder = classes.some(cls => /^dark:border-/.test(cls));

		expect(classes).toContain('aria-invalid:border-destructive');
		if (darkBorder) {
			expect(classes).toContain('dark:aria-invalid:border-destructive');
		}
	});
});

describe('Button aria-disabled dimming', () => {
	test.each(VARIANTS)('%s dims the whole button only while it is not focused', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);

		expect(classes).toContain('aria-disabled:not-focus-visible:opacity-50');
		expect(classes).not.toContain('aria-disabled:opacity-50');
		expect(classes.filter(cls => /^aria-disabled:focus-visible:.*opacity/.test(cls))).toEqual([]);
	});

	test.each(VARIANTS)('%s veils its content and fill, not its ring, while focused', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);

		expect(classes).toEqual(
			expect.arrayContaining([
				'aria-disabled:focus-visible:relative',
				'aria-disabled:focus-visible:after:absolute',
				'aria-disabled:focus-visible:after:inset-0',
				'aria-disabled:focus-visible:after:rounded-[inherit]',
				'aria-disabled:focus-visible:after:bg-background/50'
			])
		);
		expect(classes).toContain('focus-visible:ring-[3px]');
	});
});
