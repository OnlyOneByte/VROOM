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
		const color = match?.[1];
		return color ? { color, alpha: Number(match?.[2] ?? 100) } : null;
	}

	test.each(VARIANTS)(
		'%s keeps the element opaque while aria-disabled, so the ring is not dimmed',
		variant => {
			const classes = buttonVariants({ variant }).split(/\s+/);

			expect(classes.filter(cls => /^(dark:)?aria-disabled:opacity-/.test(cls))).toEqual([]);
		}
	);

	test.each(VARIANTS)('%s dims its text to the muted token while aria-disabled', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);

		expect(classes.filter(cls => /^(dark:)?aria-disabled:text-/.test(cls))).toEqual([
			'aria-disabled:text-muted-foreground'
		]);
	});

	test.each(VARIANTS)('%s halves each background it paints while aria-disabled', variant => {
		const classes = buttonVariants({ variant }).split(/\s+/);

		for (const mode of ['', 'dark:']) {
			const fill = classes.findLast(cls => new RegExp(`^${mode}bg-[a-z-]+(/\\d+)?$`).test(cls));
			if (!fill) continue;
			const [, color, alpha = '100'] = fill.match(/bg-([a-z-]+)(?:\/(\d+))?$/)!;
			expect(classes).toContain(`${mode}aria-disabled:bg-${color}/${Number(alpha) / 2}`);
		}
	});

	test.each(VARIANTS.flatMap(variant => [`${variant}:`, `${variant}:dark:`]))(
		'%s doubles the ring alpha while focused and aria-disabled, so the busy ring stays strong',
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
