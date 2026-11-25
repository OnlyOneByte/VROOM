import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const APP_CSS = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'app.css'),
	'utf-8'
);

const TOAST_TYPES = [
	'default',
	'normal',
	'action',
	'loading',
	'success',
	'error',
	'warning',
	'info'
];

function rules(css: string): { selectors: string[]; body: string }[] {
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = '', body = '']) => ({
		selectors: selectors.split(',').map(s => s.trim()),
		body
	}));
}

const toastRules = rules(APP_CSS);

describe('sonner toasts in app.css', () => {
	test('the toast width never exceeds the viewport minus 2rem', () => {
		const base = toastRules.find(r => r.selectors.includes('[data-sonner-toast]'));
		expect(base?.body).toMatch(/min-width:\s*min\(24rem,\s*calc\(100vw - 2rem\)\)/);
		expect(base?.body).toMatch(/max-width:\s*min\(32rem,\s*calc\(100vw - 2rem\)\)/);
	});

	test.each(TOAST_TYPES)('a %s toast is the charcoal C3 bar with its light text', type => {
		const rule = toastRules.find(
			r =>
				r.selectors.includes(`[data-sonner-toast][data-type='${type}']`) &&
				/background-color/.test(r.body)
		);
		expect(rule, `no surface rule for data-type='${type}'`).toBeDefined();
		expect(rule?.body).toMatch(/background-color:\s*var\(--bar\)/);
		expect(rule?.body).toMatch(/color:\s*var\(--bar-on\)/);
	});

	test.each(['success', 'error', 'warning'])('a %s toast colours its glyph by type', type => {
		const rule = toastRules.find(
			r =>
				r.selectors.includes(`[data-sonner-toast][data-type='${type}']`) &&
				/--toast-glyph/.test(r.body)
		);
		expect(rule?.body).toMatch(/--toast-glyph:\s*oklch\(/);
	});

	test('title and action weights are important, so they beat sonner’s unlayered defaults', () => {
		const title = toastRules.find(r => r.selectors.includes('[data-sonner-toast] [data-title]'));
		const action = toastRules.find(
			r => r.selectors.includes('[data-sonner-toast] [data-button]') && /font-weight/.test(r.body)
		);
		expect(title?.body).toMatch(/font-weight:\s*650\s*!important/);
		expect(action?.body).toMatch(/font-weight:\s*650\s*!important/);
		expect(action?.body).toMatch(/font-size:\s*0\.875rem\s*!important/);
	});

	test('the action and close button show a light focus ring on the charcoal card', () => {
		const focus = toastRules.find(r =>
			r.selectors.includes('[data-sonner-toast] [data-button]:focus-visible')
		);
		expect(focus?.selectors).toContain('[data-sonner-toast] [data-close-button]:focus-visible');
		expect(focus?.body).toMatch(/outline:\s*2px solid var\(--bar-on\)/);
	});

	test('the toast keeps the C3 radius and the single pop shadow, with no border', () => {
		const base = toastRules.find(r => r.selectors.includes('[data-sonner-toast]'));
		expect(base?.body).toMatch(/border-radius:\s*var\(--r-lg\)/);
		expect(base?.body).toMatch(/box-shadow:\s*var\(--shadow-pop\)/);
		expect(base?.body).toMatch(/border:\s*0/);
	});

	test('the rule parser is non-vacuous', () => {
		expect(rules('a, b { color: red; }')).toEqual([
			{ selectors: ['a', 'b'], body: ' color: red; ' }
		]);
		expect(toastRules.length).toBeGreaterThan(10);
	});
});
