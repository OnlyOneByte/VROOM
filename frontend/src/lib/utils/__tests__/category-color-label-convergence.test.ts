import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { CATEGORY_COLOR_TOKENS, CATEGORY_LABELS, getCategoryChartColor } from '../chart-colors';
import {
	CATEGORY_ICONS,
	categoryLabels,
	getCategoryBadgeClasses,
	getCategoryIcon
} from '../expense-helpers';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';
import type { StatCardIconColor } from '#lib/components/charts/StatCard.svelte';

const ALL_CATEGORIES: ExpenseCategory[] = [
	'fuel',
	'maintenance',
	'financial',
	'regulatory',
	'enhancement',
	'misc'
];

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', '..');
const APP_CSS = readFileSync(join(SRC_ROOT, 'app.css'), 'utf8');
const STAT_CARD_SOURCE = readFileSync(
	join(SRC_ROOT, 'lib', 'components', 'charts', 'StatCard.svelte'),
	'utf8'
);
const CATEGORY_SELECTOR_SOURCE = readFileSync(
	join(SRC_ROOT, 'lib', 'components', 'expenses', 'form', 'CategorySelector.svelte'),
	'utf8'
);

function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectTsFiles(full, acc);
		} else if (entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

const CATEGORY_ALTERNATION = ALL_CATEGORIES.join('|');

const COLOR_AND_LABEL_HOME = 'lib/utils/chart-colors.ts';
const ICON_HOME = 'lib/utils/expense-helpers.ts';

const COLOR_VALUE_PATTERNS = {
	badgeClasses: `'(?:text|bg|border)-`,
	chartColor: `'var\\(--`,
	token: `'(?:chart-\\d+|neutral)'`
};

const LABEL_VALUE_PATTERN = `'[A-Z]`;

const ICON_VALUE_PATTERN = `[A-Z][A-Za-z0-9]*\\s*[,}]?\\s*$`;

interface ScannedFile {
	rel: string;
	source: string;
}

function relativeToSrc(file: string): string {
	return relative(SRC_ROOT, file).split('\\').join('/');
}

function isTestSource(rel: string): boolean {
	return rel.includes('__tests__/') || rel.endsWith('.test.ts');
}

const SVELTE_FILES: ScannedFile[] = collectSvelteFiles(SRC_ROOT).map(file => ({
	rel: relativeToSrc(file),
	source: readFileSync(file, 'utf8')
}));

const RENDERING_SOURCES: ScannedFile[] = [
	...SVELTE_FILES,
	...collectTsFiles(SRC_ROOT).map(file => ({
		rel: relativeToSrc(file),
		source: readFileSync(file, 'utf8')
	}))
].filter(file => !isTestSource(file.rel));

function findPerCategoryEntries(
	valuePattern: string,
	sanctionedHome: string,
	files: ScannedFile[] = RENDERING_SOURCES
): string[] {
	const entry = new RegExp(`^\\s*'?(?:${CATEGORY_ALTERNATION})'?:\\s*${valuePattern}`);
	const offenders: string[] = [];
	for (const { rel, source } of files) {
		if (rel === sanctionedHome) continue;
		source.split('\n').forEach((line, index) => {
			if (entry.test(line)) offenders.push(`${rel}:${index + 1}`);
		});
	}
	return offenders;
}

function tokenFromBadgeClasses(classes: string): string {
	const text = /\btext-(chart-\d+)\b/.exec(classes);
	const tint = /\bbg-(chart-\d+)\/\d+\b/.exec(classes);
	if (text && tint) {
		return text[1] === tint[1]
			? (text[1] as string)
			: `badge halves disagree: text-${text[1]} vs bg-${tint[1]}`;
	}
	if (classes === 'text-muted-foreground bg-muted') return 'neutral';
	return `unrecognised badge classes: ${classes}`;
}

function tokenFromChartColor(color: string): string {
	const chart = /^var\(--(chart-\d+)\)$/.exec(color);
	if (chart) return chart[1] as string;
	if (color === 'var(--primary)') return 'neutral';
	return `unrecognised chart color: ${color}`;
}

describe('the category source scan is live', () => {
	test('it found both halves of the tree (not a no-op over a renamed directory)', () => {
		expect(SVELTE_FILES.length).toBeGreaterThan(100);
		expect(RENDERING_SOURCES.length).toBeGreaterThan(200);
		expect(RENDERING_SOURCES.some(file => file.rel === 'lib/utils/expense-helpers.ts')).toBe(true);
		expect(
			RENDERING_SOURCES.some(
				file => file.rel === 'lib/components/expenses/OfflineExpenseCards.svelte'
			)
		).toBe(true);
	});
});

describe('one category → color assignment', () => {
	test('the assignment is chart-1…chart-5 in declaration order, with misc neutral', () => {
		expect(CATEGORY_COLOR_TOKENS).toEqual({
			fuel: 'chart-1',
			maintenance: 'chart-2',
			financial: 'chart-3',
			regulatory: 'chart-4',
			enhancement: 'chart-5',
			misc: 'neutral'
		});
	});

	test('badge and chart renderings resolve to the same token for every category', () => {
		for (const category of ALL_CATEGORIES) {
			const token: string = CATEGORY_COLOR_TOKENS[category];
			expect(tokenFromBadgeClasses(getCategoryBadgeClasses(category)), `badge → ${category}`).toBe(
				token
			);
			expect(tokenFromChartColor(getCategoryChartColor(category)), `chart → ${category}`).toBe(
				token
			);
		}
	});

	test('the extractors really parse the renderings (not vacuously equal)', () => {
		expect(getCategoryBadgeClasses('maintenance')).toBe('text-chart-2 bg-chart-2/10');
		expect(getCategoryChartColor('maintenance')).toBe('var(--chart-2)');
		expect(tokenFromBadgeClasses('text-chart-2 bg-chart-2/10')).toBe('chart-2');
		expect(tokenFromChartColor('var(--chart-2)')).toBe('chart-2');
	});

	test('a badge whose text and tint halves name different tokens is not a token', () => {
		expect(tokenFromBadgeClasses('text-chart-4 bg-chart-1/10')).toBe(
			'badge halves disagree: text-chart-4 vs bg-chart-1'
		);
		expect(tokenFromBadgeClasses('text-chart-4 bg-chart-1/10')).not.toBe('chart-4');
	});

	test('no second category → color map exists anywhere under src', () => {
		const offenders = Object.values(COLOR_VALUE_PATTERNS).flatMap(pattern =>
			findPerCategoryEntries(pattern, COLOR_AND_LABEL_HOME)
		);

		expect(
			offenders,
			`Hand-written category → color entries found: ${JSON.stringify(offenders)}. ` +
				'A category is assigned a color ONCE, in CATEGORY_COLOR_TOKENS (chart-colors.ts); ' +
				'renderers key their own map by COLOR TOKEN and derive the category from it, or ' +
				'badges drift from chart colors again.'
		).toEqual([]);
	});

	test('every per-category value pattern still matches the shape it hunts', () => {
		const synthetic: ScannedFile[] = [
			{
				rel: 'lib/components/fake/Divergent.svelte',
				source: [
					"\tfuel: 'text-chart-3 bg-chart-3/10',",
					"\tmaintenance: 'var(--chart-7)',",
					"\t'financial': 'chart-8',",
					"\tregulatory: 'neutral',",
					"\tenhancement: 'Enhancement',",
					'\tmisc: Coffee'
				].join('\n')
			},
			{ rel: COLOR_AND_LABEL_HOME, source: "\tfuel: 'chart-1'," },
			{ rel: ICON_HOME, source: '\tfuel: Fuel,' }
		];
		const hits = (pattern: string, home: string) =>
			findPerCategoryEntries(pattern, home, synthetic);

		expect(hits(COLOR_VALUE_PATTERNS.badgeClasses, COLOR_AND_LABEL_HOME)).toEqual([
			'lib/components/fake/Divergent.svelte:1'
		]);
		expect(hits(COLOR_VALUE_PATTERNS.chartColor, COLOR_AND_LABEL_HOME)).toEqual([
			'lib/components/fake/Divergent.svelte:2'
		]);
		expect(hits(COLOR_VALUE_PATTERNS.token, COLOR_AND_LABEL_HOME)).toEqual([
			'lib/components/fake/Divergent.svelte:3',
			'lib/components/fake/Divergent.svelte:4'
		]);
		expect(hits(LABEL_VALUE_PATTERN, COLOR_AND_LABEL_HOME)).toEqual([
			'lib/components/fake/Divergent.svelte:5'
		]);
		expect(hits(ICON_VALUE_PATTERN, ICON_HOME)).toEqual(['lib/components/fake/Divergent.svelte:6']);
		expect(hits(COLOR_VALUE_PATTERNS.token, 'lib/components/fake/Divergent.svelte')).toEqual([
			`${COLOR_AND_LABEL_HOME}:1`
		]);
	});
});

describe('one category → label map', () => {
	test('categoryLabels and CATEGORY_LABELS agree on every category', () => {
		expect(Object.keys(categoryLabels).sort()).toEqual(Object.keys(CATEGORY_LABELS).sort());
		for (const category of ALL_CATEGORIES) {
			expect(categoryLabels[category], `label → ${category}`).toBe(CATEGORY_LABELS[category]);
		}
	});

	test('the fuel label names charging on every surface', () => {
		expect(categoryLabels.fuel).toBe('Fuel & Charging');
		expect(CATEGORY_LABELS.fuel).toBe('Fuel & Charging');
	});

	test('no second category → label map exists anywhere under src', () => {
		const offenders = findPerCategoryEntries(LABEL_VALUE_PATTERN, COLOR_AND_LABEL_HOME);

		expect(
			offenders,
			`Hand-written category → label entries found: ${JSON.stringify(offenders)}. ` +
				'A category is named ONCE, in CATEGORY_LABELS (chart-colors.ts); import it (or ' +
				'`getCategoryLabel`) instead of writing a second set of names.'
		).toEqual([]);
	});

	test('no component renders a category as the bare enum value', () => {
		const bareInterpolation = /(?<![=$])\{\s*[A-Za-z_$][\w$.]*\.category\s*\}/;
		const capitalizedEnum = /\bcapitalize\(\s*[A-Za-z_$][\w$.[\]']*\.category/;

		const offenders: string[] = [];
		for (const { rel, source } of SVELTE_FILES) {
			if (isTestSource(rel)) continue;
			source.split('\n').forEach((line, index) => {
				if (bareInterpolation.test(line) || capitalizedEnum.test(line)) {
					offenders.push(`${rel}:${index + 1}`);
				}
			});
		}

		expect(
			offenders,
			`Raw category enum rendered at: ${JSON.stringify(offenders)}. ` +
				'Render `getCategoryLabel(x.category)` (string-keyed, falls back to the raw key) or ' +
				'`categoryLabels[x.category]` — a bare interpolation shows "fuel" where every other ' +
				'surface shows "Fuel & Charging".'
		).toEqual([]);
	});

	test('the bare-enum scan recognises the shape it hunts (and spares the canonical helpers)', () => {
		const bareInterpolation = /(?<![=$])\{\s*[A-Za-z_$][\w$.]*\.category\s*\}/;
		expect(bareInterpolation.test('<Badge>{expense.category}</Badge>')).toBe(true);
		expect(bareInterpolation.test('{ currentConflict.localExpense.category }')).toBe(true);
		expect(bareInterpolation.test('{getCategoryLabel(expense.category)}')).toBe(false);
		expect(bareInterpolation.test('{categoryLabels[expense.category]}')).toBe(false);
		expect(bareInterpolation.test('<Select value={row.category} />')).toBe(false);
	});
});

describe('one category → icon assignment', () => {
	test('the assignment is the picker\u2019s six distinct icons', () => {
		expect(Object.keys(CATEGORY_ICONS).sort()).toEqual([...ALL_CATEGORIES].sort());
		expect(new Set(ALL_CATEGORIES.map(category => CATEGORY_ICONS[category])).size).toBe(6);
	});

	test('getCategoryIcon derives from the one assignment', () => {
		for (const category of ALL_CATEGORIES) {
			expect(getCategoryIcon(category), `icon → ${category}`).toBe(CATEGORY_ICONS[category]);
		}
	});

	test('the form\u2019s category picker derives its icons from the same assignment', () => {
		expect(CATEGORY_SELECTOR_SOURCE).toContain('getCategoryIcon(category.value)');
	});

	test('no second category → icon map exists anywhere under src', () => {
		const keyedMap = findPerCategoryEntries(ICON_VALUE_PATTERN, ICON_HOME);

		const categoryEntryObject = new RegExp(
			`\\{[^{}]*\\bvalue:\\s*'(?:${CATEGORY_ALTERNATION})'[^{}]*\\}`,
			'g'
		);
		const entryWithOwnIcon: string[] = [];
		for (const { rel, source } of RENDERING_SOURCES) {
			for (const match of source.matchAll(categoryEntryObject)) {
				if (/\bicon:/.test(match[0])) entryWithOwnIcon.push(rel);
			}
		}

		const offenders = [...keyedMap, ...new Set(entryWithOwnIcon)];
		expect(
			offenders,
			`Hand-written category → icon entries found: ${JSON.stringify(offenders)}. ` +
				'A category is assigned an icon ONCE, in CATEGORY_ICONS (expense-helpers.ts); call ' +
				'`getCategoryIcon` instead, or the picker and the table disagree again.'
		).toEqual([]);
	});

	test('the icon scans recognise the shapes they hunt', () => {
		const keyedMap = new RegExp(`^\\s*'?(?:${CATEGORY_ALTERNATION})'?:\\s*${ICON_VALUE_PATTERN}`);
		expect(keyedMap.test('\tregulatory: DollarSign,')).toBe(true);
		expect(keyedMap.test("\t'misc': Coffee")).toBe(true);
		expect(keyedMap.test("\tmisc: 'Misc',")).toBe(false);

		const entryObject = new RegExp(`\\{[^{}]*\\bvalue:\\s*'(?:${CATEGORY_ALTERNATION})'[^{}]*\\}`);
		expect(entryObject.test("{ value: 'fuel', label: 'Fuel', icon: Fuel }")).toBe(true);
		expect(entryObject.test("{ value: 'light', label: 'Light', icon: Sun }")).toBe(false);
	});
});

describe('the two category-color helpers cannot be confused', () => {
	test('each name has exactly one meaning', () => {
		expect(getCategoryBadgeClasses('fuel')).toBe('text-chart-1 bg-chart-1/10');
		expect(getCategoryChartColor('fuel')).toBe('var(--chart-1)');
	});
});

describe('StatCard icon tokens cover the theme', () => {
	test('every --chart-N token app.css defines is a StatCard icon token', () => {
		const themeTokens = new Set(
			[...APP_CSS.matchAll(/--chart-(\d+)\s*:/g)].map(match => `chart-${match[1]}`)
		);
		expect(themeTokens.size).toBeGreaterThan(4);

		const statCardTokens = new Set(
			[...STAT_CARD_SOURCE.matchAll(/'(chart-\d+)'/g)].map(match => match[1] as string)
		);

		expect(
			[...statCardTokens].sort(),
			'StatCard ICON_COLOR_MAP / StatCardIconColor must list every --chart-N token in app.css; ' +
				'a token past the end of the map renders the primary tint instead.'
		).toEqual([...themeTokens].sort());
	});

	test('an out-of-range icon token is a compile error', () => {
		// @ts-expect-error
		const outOfRange: StatCardIconColor = 'chart-9';
		expect(outOfRange).toBe('chart-9');

		const inRange: StatCardIconColor = 'chart-8';
		expect(inRange).toBe('chart-8');
	});
});
