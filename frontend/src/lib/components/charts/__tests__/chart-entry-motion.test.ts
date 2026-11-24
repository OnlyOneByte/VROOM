import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_FILES = ['line-chart-animations.css', 'bar-chart-animations.css'];
const MAX_ENTRY_MS = 400;

const { pieProps, motion } = vi.hoisted(() => ({
	pieProps: vi.fn<(props: Record<string, unknown>) => void>(),
	motion: { reduce: false }
}));

vi.mock('layerchart', () => ({
	PieChart: (_anchor: unknown, props: { props: Record<string, unknown> }) => {
		pieProps(props.props);
	},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

vi.mock('svelte/motion', async importOriginal => ({
	...(await importOriginal<typeof import('svelte/motion')>()),
	prefersReducedMotion: {
		get current() {
			return motion.reduce;
		}
	}
}));

const AppPieChart = (await import('../AppPieChart.svelte')).default;

class VisibleIntersectionObserver {
	constructor(private readonly callback: ConstructorParameters<typeof IntersectionObserver>[0]) {}
	observe(target: Element) {
		queueMicrotask(() =>
			this.callback(
				[{ isIntersecting: true, intersectionRatio: 1, target } as IntersectionObserverEntry],
				this as unknown as IntersectionObserver
			)
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function toMs(value: string): number {
	return value.endsWith('ms') ? Number(value.slice(0, -2)) : Number(value.slice(0, -1)) * 1000;
}

function blockAfter(css: string, start: number): string {
	let depth = 0;
	for (let i = css.indexOf('{', start); i < css.length; i++) {
		if (css[i] === '{') depth++;
		if (css[i] === '}') depth--;
		if (depth === 0) return css.slice(start, i + 1);
	}
	return css.slice(start);
}

async function mountPie() {
	vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
	render(AppPieChart, {
		props: {
			title: 'Spending by category',
			data: [{ key: 'fuel', label: 'Fuel', value: 10, color: '#f00' }]
		}
	});
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
	const props = pieProps.mock.lastCall?.[0] as { pie: { motion: unknown } } | undefined;
	return props?.pie.motion;
}

afterEach(() => {
	cleanup();
	pieProps.mockClear();
	vi.unstubAllGlobals();
	motion.reduce = false;
});

describe.each(CSS_FILES)('%s', file => {
	const css = readFileSync(join(HERE, '..', file), 'utf8');

	test(`every entry animation ends within ${MAX_ENTRY_MS} ms`, () => {
		const rules = [...css.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]!);
		const ends = rules.flatMap(rule => {
			const duration = rule.match(/animation:\s*[\w-]+\s+([\d.]+m?s)/)?.[1];
			const delay = rule.match(/animation-delay:\s*([\d.]+m?s)/)?.[1];
			return duration ? [toMs(duration) + (delay ? toMs(delay) : 0)] : [];
		});
		expect(ends.length).toBeGreaterThan(0);
		for (const ms of ends) expect(ms).toBeLessThanOrEqual(MAX_ENTRY_MS);
	});

	test('the hidden starting state only applies when motion is allowed', () => {
		const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
		expect(start).toBeGreaterThan(-1);
		const outside = css.replace(blockAfter(css, start), '');
		expect(outside).not.toMatch(/animate-ready/);
	});
});

test('the hover highlight point never waits for the entry fade', () => {
	const css = readFileSync(join(HERE, '..', 'line-chart-animations.css'), 'utf8');
	const circleSelectors = [...css.matchAll(/([^{}]*circle[^{}]*)\{/g)].map(m => m[1]!.trim());
	expect(circleSelectors.length).toBeGreaterThan(0);
	for (const selector of circleSelectors) expect(selector).toContain(':not(.lc-highlight-point)');
});

describe('AppPieChart entry motion', () => {
	test(`tweens for at most ${MAX_ENTRY_MS} ms`, async () => {
		const pieMotion = (await mountPie()) as { type: string; duration: number };
		expect(pieMotion.type).toBe('tween');
		expect(pieMotion.duration).toBeLessThanOrEqual(MAX_ENTRY_MS);
	});

	test('draws the final slices at once under reduced motion', async () => {
		motion.reduce = true;
		expect(await mountPie()).toBe('none');
	});
});
