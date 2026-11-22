import { describe, expect, test } from 'vitest';
import { THEME_REGISTRY } from '#lib/theme/theme-registry.ts';
import { CATEGORY_COLOR_TOKENS, getCategoryChartColor } from '../chart-colors';

const CLOSEST_CATEGORY_PAIR_IN_ANY_THEME = 0.06;

function oklab(value: string): [number, number, number] {
	const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
	if (!m) throw new Error(`not an oklch() value: ${value}`);
	const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
	return [L, C * Math.cos(H), C * Math.sin(H)];
}

function distance(x: string, y: string): number {
	const [a, b] = [oklab(x), oklab(y)];
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const CATEGORY_CHART_TOKENS = Object.values(CATEGORY_COLOR_TOKENS).filter(
	token => token !== 'neutral'
);

describe('the Misc category colour', () => {
	test('is the neutral muted-foreground token the Misc badge uses, not the theme accent', () => {
		expect(CATEGORY_COLOR_TOKENS.misc).toBe('neutral');
		expect(getCategoryChartColor('misc')).toBe('var(--muted-foreground)');
	});

	describe.each(Object.values(THEME_REGISTRY))('theme "$id"', theme => {
		test.each(['light', 'dark'] as const)(
			'%s: Misc is further from every category colour than the closest category pair',
			mode => {
				const tokens = theme[mode];
				for (const token of CATEGORY_CHART_TOKENS) {
					expect(
						distance(tokens['muted-foreground'], tokens[token]),
						`${token} vs muted-foreground`
					).toBeGreaterThan(CLOSEST_CATEGORY_PAIR_IN_ANY_THEME);
				}
			}
		);
	});
});
