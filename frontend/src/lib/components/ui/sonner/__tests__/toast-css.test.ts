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

	test.each(TOAST_TYPES)('a %s toast paints the themed card surface', type => {
		const rule = toastRules.find(r =>
			r.selectors.includes(`[data-sonner-toast][data-type='${type}']`)
		);
		expect(rule, `no rule for data-type='${type}'`).toBeDefined();
		expect(rule?.body).toMatch(/background-color:\s*var\(--card\)/);
	});

	test('the rule parser is non-vacuous', () => {
		expect(rules('a, b { color: red; }')).toEqual([
			{ selectors: ['a', 'b'], body: ' color: red; ' }
		]);
		expect(toastRules.length).toBeGreaterThan(10);
	});
});
