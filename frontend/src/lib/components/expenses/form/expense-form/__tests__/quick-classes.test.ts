import { describe, expect, test } from 'vitest';
import { QUICK_FIGURE_INPUT } from '../quick-classes';

const classes = QUICK_FIGURE_INPUT.split(' ');

describe('the underlined quick-add fields', () => {
	test('keep one bottom border width in every state, so focusing a field moves nothing', () => {
		const widths = classes.filter(
			c => /(^|:)border-b-/.test(c) && !/border-b-(needle|destructive)/.test(c)
		);
		expect(widths.every(c => c.endsWith('border-b-[1.5px]'))).toBe(true);
		expect(classes.some(c => c.startsWith('focus-visible:border-b-'))).toBe(false);
		expect(classes).toContain('focus-visible:shadow-[0_1.5px_0_0_var(--color-needle)]');
	});

	test('an empty figure shows its placeholder in a faint tone, so 0.000 does not read as a value', () => {
		expect(classes).toContain('placeholder:text-muted-foreground/40');
	});

	test('show the error colour while an invalid field has focus', () => {
		expect(classes).toContain('aria-invalid:focus-visible:border-destructive');
		expect(classes).toContain(
			'aria-invalid:focus-visible:shadow-[0_1.5px_0_0_var(--color-destructive)]'
		);
	});
});
