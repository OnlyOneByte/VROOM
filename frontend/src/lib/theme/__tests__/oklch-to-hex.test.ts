/**
 * Unit tests for oklchToHex (#333 — the PWA theme-color tint converter). Pure input→output, no DOM. Pins
 * the OKLab→sRGB→hex pipeline at known anchor points + the fail-soft null contract callers rely on.
 */

import { describe, expect, test } from 'vitest';
import { oklchToHex } from '../oklch-to-hex';

describe('oklchToHex — anchor colors', () => {
	test('pure white oklch(1 0 0) → #ffffff', () => {
		expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff');
	});

	test('pure black oklch(0 0 0) → #000000', () => {
		expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
	});

	test('the default dark surface oklch(0.141 0.005 285.823) → near-black #09090b', () => {
		// The exact value the theme-color meta uses for default.dark — pins the conversion the store relies on.
		expect(oklchToHex('oklch(0.141 0.005 285.823)')).toBe('#09090b');
	});

	test('a chromatic token oklch(0.98 0.01 265) (aurora.light surface) → #f5f8ff', () => {
		expect(oklchToHex('oklch(0.98 0.01 265)')).toBe('#f5f8ff');
	});

	test('alpha is ignored (status bar is opaque): oklch(1 0 0 / 50%) → #ffffff', () => {
		expect(oklchToHex('oklch(1 0 0 / 50%)')).toBe('#ffffff');
	});
});

describe('oklchToHex — output shape + gamut', () => {
	test('always returns a 7-char #rrggbb lowercase hex for a valid oklch', () => {
		for (const v of ['oklch(0.5 0.1 30)', 'oklch(0.7 0.2 200)', 'oklch(0.3 0.05 120)']) {
			expect(oklchToHex(v)).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	test('an out-of-gamut vivid token is clamped to a valid hex, not NaN/garbage', () => {
		// A very high chroma can push a channel out of [0,1]; the converter clamps rather than emitting junk.
		const hex = oklchToHex('oklch(0.6 0.4 25)');
		expect(hex).toMatch(/^#[0-9a-f]{6}$/);
	});
});

describe('oklchToHex — fail-soft null contract', () => {
	test.each(['#2563eb', 'rgb(1,2,3)', 'hsl(200 50% 50%)', 'not a color', ''])(
		'returns null for a non-oklch input %p (caller falls back)',
		input => {
			expect(oklchToHex(input)).toBeNull();
		}
	);
});
