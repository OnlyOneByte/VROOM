import { describe, expect, test } from 'vitest';
import { cn } from '#lib/utils.js';
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

describe('Button aria-disabled focus ring', () => {
	function ring(classes: string[], prefix: string): { color: string; alpha: number } | null {
		const pattern = new RegExp(`^${prefix}ring-([a-z-]+)(?:/(\\d+))?$`);
		const match = classes.map(cls => cls.match(pattern)).findLast(Boolean);
		return match ? { color: match[1], alpha: Number(match[2] ?? 100) } : null;
	}

	test.each(VARIANTS)('%s still dims the whole button while aria-disabled', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);

		expect(classes).toContain('aria-disabled:opacity-50');
	});

	test.each(VARIANTS.flatMap(variant => [`${variant}:`, `${variant}:dark:`]))(
		'%s doubles the ring alpha while focused and aria-disabled, so opacity-50 leaves the normal ring',
		key => {
			const [variant, mode = ''] = key.split(/:(.*)/) as [(typeof VARIANTS)[number], string];
			const classes = buttonVariants({ variant }).split(/\s+/);
			const normal = ring(classes, `${mode}focus-visible:`) ?? ring(classes, 'focus-visible:');
			const dimmed =
				ring(classes, `${mode}aria-disabled:focus-visible:`) ??
				ring(classes, 'aria-disabled:focus-visible:');

			expect(normal).not.toBeNull();
			expect(dimmed).toEqual({ color: normal!.color, alpha: Math.min(100, normal!.alpha * 2) });
		}
	);

	test('a positioned caller keeps its position while focused and aria-disabled', () => {
		const classes = cn(buttonVariants({ variant: 'outline' }), 'absolute top-1/2').split(/\s+/);

		expect(classes).toContain('absolute');
		expect(
			classes.filter(cls => /^aria-disabled:.*(relative|absolute|fixed|sticky|static)$/.test(cls))
		).toEqual([]);
	});
});
