import { describe, expect, test } from 'vitest';
import { THEME_REGISTRY } from '../theme-registry';
import type { ThemeTokenKey, ThemeTokens } from '../theme-types';

const NORMAL_MIN = 15;
const CVD_MIN = 8;
const SURFACE_MIN = 3;
const CHROMA_MIN = 0.08;
const SLOTS = Array.from({ length: 8 }, (_, i) => `chart-${i + 1}` as ThemeTokenKey);

const MACHADO = {
	protanopia: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deuteranopia: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritanopia: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
} as const;

type Vision = keyof typeof MACHADO;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function linearRgb(oklch: string): [number, number, number] {
	const m = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
	if (!m) throw new Error(`not an oklch() value: ${oklch}`);
	const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const a = C * Math.cos((H * Math.PI) / 180);
	const b = C * Math.sin((H * Math.PI) / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		clamp01(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
		clamp01(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
		clamp01(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s)
	];
}

function simulate(rgb: [number, number, number], vision: Vision): [number, number, number] {
	const [r, g, b] = rgb;
	const [x, y, z] = MACHADO[vision];
	return [
		clamp01(x[0] * r + x[1] * g + x[2] * b),
		clamp01(y[0] * r + y[1] * g + y[2] * b),
		clamp01(z[0] * r + z[1] * g + z[2] * b)
	];
}

function oklab([r, g, b]: [number, number, number]): [number, number, number] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

function deltaE(x: string, y: string, vision?: Vision): number {
	const see = (c: string) => {
		const rgb = linearRgb(c);
		return oklab(vision ? simulate(rgb, vision) : rgb);
	};
	const [a, b] = [see(x), see(y)];
	return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function contrast(x: string, y: string): number {
	const lum = (c: string) => {
		const [r, g, b] = linearRgb(c);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [lum(x), lum(y)].sort((a, b) => b - a) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

const ADJACENT = SLOTS.slice(0, -1).map((slot, i) => [slot, SLOTS[i + 1]!] as const);
const CATEGORY_SLOTS = SLOTS.slice(0, 5);
const CATEGORY_PAIRS = CATEGORY_SLOTS.flatMap((a, i) =>
	CATEGORY_SLOTS.slice(i + 2).map(b => [a, b] as const)
);

function chroma(oklch: string): number {
	const m = oklch.match(/oklch\(\s*[\d.]+\s+([\d.]+)/);
	if (!m) throw new Error(`not an oklch() value: ${oklch}`);
	return Number(m[1]);
}
const VARIANTS = Object.values(THEME_REGISTRY).flatMap(theme =>
	(['light', 'dark'] as const).map(variant => ({
		label: `${theme.id}.${variant}`,
		tokens: theme[variant] as ThemeTokens
	}))
);

describe('the palette checks are calibrated', () => {
	test('identical colours are 0 apart and black/white are 100 apart', () => {
		expect(deltaE('oklch(0.5 0.1 30)', 'oklch(0.5 0.1 30)')).toBe(0);
		expect(deltaE('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(100, 0);
	});

	test('a red/green pair that is clear to full colour vision collapses under deuteranopia', () => {
		const red = 'oklch(0.6 0.2 30)';
		const green = 'oklch(0.6 0.2 140)';
		expect(deltaE(red, green)).toBeGreaterThan(NORMAL_MIN);
		expect(deltaE(red, green, 'deuteranopia')).toBeLessThan(CVD_MIN);
	});

	test('the old solarpunk light chart-5/chart-6 pair is rejected (non-vacuous)', () => {
		expect(deltaE('oklch(0.5 0.13 330)', 'oklch(0.52 0.12 315)')).toBeLessThan(NORMAL_MIN);
	});
});

describe.each(VARIANTS)('$label chart slots', ({ label, tokens }) => {
	test.each(ADJACENT)(`%s and %s are ≥ ${NORMAL_MIN} apart for full colour vision`, (a, b) => {
		const d = deltaE(tokens[a], tokens[b]);
		expect(d, `${label}: ${a}↔${b} ΔE ${d.toFixed(1)}`).toBeGreaterThanOrEqual(NORMAL_MIN);
	});

	test.each(ADJACENT)(
		`%s and %s stay ≥ ${CVD_MIN} apart under each colour-vision deficiency`,
		(a, b) => {
			for (const vision of Object.keys(MACHADO) as Vision[]) {
				const d = deltaE(tokens[a], tokens[b], vision);
				expect(d, `${label}: ${a}↔${b} ΔE ${d.toFixed(1)} (${vision})`).toBeGreaterThanOrEqual(
					CVD_MIN
				);
			}
		}
	);

	test.each(CATEGORY_PAIRS)(
		`category slots %s and %s, which can touch in a stack, are as far apart as neighbours`,
		(a, b) => {
			const d = deltaE(tokens[a], tokens[b]);
			expect(d, `${label}: ${a}↔${b} ΔE ${d.toFixed(1)}`).toBeGreaterThanOrEqual(NORMAL_MIN);
			for (const vision of Object.keys(MACHADO) as Vision[]) {
				const v = deltaE(tokens[a], tokens[b], vision);
				expect(v, `${label}: ${a}↔${b} ΔE ${v.toFixed(1)} (${vision})`).toBeGreaterThanOrEqual(
					CVD_MIN
				);
			}
		}
	);

	test.each(SLOTS)(`%s has chroma ≥ ${CHROMA_MIN}, so it never reads as grey`, slot => {
		expect(chroma(tokens[slot]), `${label}: ${slot} ${tokens[slot]}`).toBeGreaterThanOrEqual(
			CHROMA_MIN
		);
	});

	test.each(SLOTS)(`%s is ≥ ${SURFACE_MIN}:1 against the card`, slot => {
		const ratio = contrast(tokens[slot], tokens.card);
		expect(ratio, `${label}: ${slot} on card ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
			SURFACE_MIN
		);
	});
});
