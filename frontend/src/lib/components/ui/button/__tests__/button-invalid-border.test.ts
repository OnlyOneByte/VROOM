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
