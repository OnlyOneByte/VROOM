import { describe, expect, test } from 'vitest';
import { cn } from '#lib/utils.js';
import { buttonVariants } from '../button.svelte';

const VARIANTS = [
	'default',
	'accent',
	'destructive',
	'outline',
	'secondary',
	'ghost',
	'link'
] as const;

describe('Button variant merging', () => {
	test('a size overrides the base classes it conflicts with', () => {
		const classes = buttonVariants({ size: 'sm' }).split(/\s+/);

		expect(classes).toContain('text-[13px]');
		expect(classes).not.toContain('text-sm');
	});

	test('a caller class overrides the variant classes it conflicts with', () => {
		const classes = buttonVariants({ size: 'sm', class: 'h-12 px-6' }).split(/\s+/);

		expect(classes).toEqual(expect.arrayContaining(['h-12', 'px-6', 'has-[>svg]:px-2.5']));
		expect(classes).not.toContain('h-8');
		expect(classes).not.toContain('px-3');
	});
});

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

	test('outline draws its edge in border-strong and drops to the hairline while aria-disabled', () => {
		const classes = buttonVariants({ variant: 'outline' }).split(/\s+/);

		expect(classes).toEqual(
			expect.arrayContaining(['border-border-strong', 'aria-disabled:border-border/50'])
		);
		expect(classes.filter(cls => /^dark:(aria-disabled:)?(border|bg)-/.test(cls))).toEqual([]);
	});

	test.each(VARIANTS.filter(v => v !== 'destructive').flatMap(v => [`${v}:`, `${v}:dark:`]))(
		'%s draws the busy ring in the full foreground token, which clears 3:1 on the page in every theme',
		key => {
			const [variant, mode = ''] = key.split(/:(.*)/) as [(typeof VARIANTS)[number], string];
			const classes = buttonVariants({ variant }).split(/\s+/);
			const busy =
				ring(classes, `${mode}aria-disabled:focus-visible:`) ??
				ring(classes, 'aria-disabled:focus-visible:');

			expect(busy).toEqual({ color: 'foreground', alpha: 100 });
		}
	);

	test('destructive doubles its own ring alpha while focused and aria-disabled', () => {
		const classes = buttonVariants({ variant: 'destructive' }).split(/\s+/);
		const normal = ring(classes, 'focus-visible:');
		const busy = ring(classes, 'aria-disabled:focus-visible:');

		expect(normal).not.toBeNull();
		expect(busy).toEqual({ color: normal!.color, alpha: normal!.alpha * 2 });
	});

	test('ghost keeps the text colour it sits on; only link uses the accent ink', () => {
		expect(
			buttonVariants({ variant: 'ghost' })
				.split(/\s+/)
				.filter(cls => /^text-(?!\[|sm|xs|base|lg)/.test(cls))
		).toEqual([]);
		expect(buttonVariants({ variant: 'link' }).split(/\s+/)).toContain('text-accent-ink');
	});

	test('the enabled focus ring stays the half-strength ring token', () => {
		const classes = buttonVariants({ variant: 'default' }).split(/\s+/);

		expect(ring(classes, 'focus-visible:')).toEqual({ color: 'ring', alpha: 50 });
	});

	test('a positioned caller keeps its position while focused and aria-disabled', () => {
		const classes = cn(buttonVariants({ variant: 'outline' }), 'absolute top-1/2').split(/\s+/);

		expect(classes).toContain('absolute');
		expect(
			classes.filter(cls => /^aria-disabled:.*(relative|absolute|fixed|sticky|static)$/.test(cls))
		).toEqual([]);
	});
});
