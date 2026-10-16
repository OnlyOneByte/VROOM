/**
 * Guard for the bug class "the same expense category renders a different color, label or icon
 * depending on the widget".
 *
 * There used to be two independently hand-written category → color maps — one returning Tailwind
 * badge classes (expense-helpers.ts), one returning CSS color values (chart-colors.ts) — and they
 * disagreed on maintenance, financial, and enhancement. Both are rendered on the dashboard at
 * once (the activity-feed badges sit beside the category pie), so one expense showed two
 * different colors on one screen. The two label maps likewise disagreed on `fuel`
 * ("Fuel & Charging" vs "Fuel"), so the analytics pies and the dashboard pie named the same
 * slice differently. The icon axis had drifted the same way: the shared helper collapsed
 * regulatory, enhancement, and misc onto one `DollarSign` while the form's category picker drew
 * three distinct icons for them.
 *
 * Each axis is now ONE assignment — `CATEGORY_COLOR_TOKENS`, `CATEGORY_LABELS` (chart-colors.ts)
 * and `CATEGORY_ICONS` (expense-helpers.ts) — and every surface derives from it. These tests fail
 * if a second map is reintroduced ANYWHERE under `src` — a duplicate is at least as likely to turn
 * up in a component as in a util, and the earlier version of this scan read a single util file — if
 * a renderer stops deriving from the shared one, or if a surface renders the raw enum value instead
 * of the canonical label. They drive the REAL exports, plus a source scan for the shapes a
 * divergence would take.
 *
 * Also pins StatCard's icon-token coverage: its class map silently stopped at chart-5 while the
 * theme had grown to eight --chart-N tokens, so `iconColor="chart-6"` rendered the primary tint.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { ExpenseCategory } from '$lib/types';
import {
	CATEGORY_COLOR_TOKENS,
	CATEGORY_LABELS,
	getCategoryChartColor,
	getCategoryColor as deprecatedChartColorAlias
} from '../chart-colors';
import {
	CATEGORY_ICONS,
	categoryLabels,
	getCategoryBadgeClasses,
	getCategoryIcon,
	getCategoryColor as deprecatedBadgeClassesAlias
} from '../expense-helpers';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';
import type { StatCardIconColor } from '$lib/components/charts/StatCard.svelte';

// A literal mirror of the ExpenseCategory union (src/lib/types/expense.ts).
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

/**
 * The `.ts` half of the source scan. The shared walker every other source-scan guard uses
 * (`collectSvelteFiles`) yields only `.svelte`, and a second category map can just as easily live
 * in a plain module — the colors one did. Deliberately NOT named `collectSvelteFiles`: the
 * meta-guard in _helpers/no-duplicate-file-walker.test.ts forbids re-declaring that symbol.
 */
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

/** The one file sanctioned to assign a category a color/label, and the one to assign an icon. */
const COLOR_AND_LABEL_HOME = 'lib/utils/chart-colors.ts';
const ICON_HOME = 'lib/utils/expense-helpers.ts';

/**
 * The value shapes a per-category COLOR entry takes — one per rendering a duplicate could target.
 * Kept as named patterns so the recogniser test below can prove each one still matches.
 */
const COLOR_VALUE_PATTERNS = {
	// Tailwind classes, as a badge/pill renders them.
	badgeClasses: `'(?:text|bg|border)-`,
	// A CSS color value, as a chart renders it.
	chartColor: `'var\\(--`,
	// The design-system token itself — a second copy of the assignment.
	token: `'(?:chart-\\d+|neutral)'`
};

/** A per-category LABEL entry: a quoted, capitalised display string. */
const LABEL_VALUE_PATTERN = `'[A-Z]`;

/** A per-category ICON entry: a bare component identifier, ending the line. */
const ICON_VALUE_PATTERN = `[A-Z][A-Za-z0-9]*\\s*[,}]?\\s*$`;

/** A source file under scan, with the repo-relative path the failure message names. */
interface ScannedFile {
	rel: string;
	source: string;
}

function relativeToSrc(file: string): string {
	return relative(SRC_ROOT, file).split('\\').join('/');
}

/**
 * Test sources are excluded: a guard (this one included) has to spell the forbidden shapes out in
 * order to look for them, and fixtures legitimately build throwaway category maps. Only the files
 * that actually render to a user can diverge.
 */
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

/**
 * Per-category entries (`fuel: <value>`) whose value matches `valuePattern` — the shape every one
 * of the historical duplicate maps took. Returns `path:line` offenders, skipping the one file
 * sanctioned to hold that axis's assignment.
 */
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

/**
 * Recover the color token a badge class pair renders. Returns a describing string (never a token)
 * for anything unrecognised OR self-contradictory, so a drifted rendering fails loudly instead of
 * matching by accident.
 *
 * Both halves are read on purpose: reading only `text-chart-N` left `'text-chart-4 bg-chart-1/10'`
 * — a mismatch a user sees as a badge whose tint is a different category's color — passing.
 */
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

/** Recover the color token a chart CSS color value renders. Same loud-failure contract. */
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
			RENDERING_SOURCES.some(file => file.rel === 'lib/components/expenses/OfflineExpenseCards.svelte')
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
		// If either extractor stopped recognising the real shapes, the test above would compare
		// two "unrecognised…" strings and could still pass. Pin both shapes explicitly.
		expect(getCategoryBadgeClasses('maintenance')).toBe('text-chart-2 bg-chart-2/10');
		expect(getCategoryChartColor('maintenance')).toBe('var(--chart-2)');
		expect(tokenFromBadgeClasses('text-chart-2 bg-chart-2/10')).toBe('chart-2');
		expect(tokenFromChartColor('var(--chart-2)')).toBe('chart-2');
	});

	test('a badge whose text and tint halves name different tokens is not a token', () => {
		// The hole this closes: the extractor used to read only the `text-` half, so a badge whose
		// 10% tint came from another category resolved to a clean token and the comparison above
		// stayed green.
		expect(tokenFromBadgeClasses('text-chart-4 bg-chart-1/10')).toBe(
			'badge halves disagree: text-chart-4 vs bg-chart-1'
		);
		expect(tokenFromBadgeClasses('text-chart-4 bg-chart-1/10')).not.toBe('chart-4');
	});

	test('no second category → color map exists anywhere under src', () => {
		// The divergence's original shape: a per-category literal mapping straight to a rendering.
		// Scanned over every .svelte/.ts source, not just the utils — the duplicate this guard was
		// written for lived in a COMPONENT.
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
		// Only the badge-class pattern is exercised by a real duplicate today, so the other
		// renderings would otherwise be scanned for by a pattern nothing proves still works.
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
		expect(hits(ICON_VALUE_PATTERN, ICON_HOME)).toEqual([
			'lib/components/fake/Divergent.svelte:6'
		]);
		// The sanctioned home of each axis is skipped, not matched-and-forgiven.
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
		// The bucket holds EV charge sessions too; the chart legends used to say just "Fuel".
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
		// `{expense.category}` prints "fuel", not "Fuel & Charging" — the activity cards and the
		// sync-conflict dialog both did, so two surfaces named the category differently from every
		// other screen. Only the canonical helpers may render it: `getCategoryLabel(…)` or
		// `categoryLabels[…]`, neither of which ends an interpolation with `.category}`.
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
		// Pins the regex itself: a scan that matched nothing would pass the test above vacuously.
		const bareInterpolation = /(?<![=$])\{\s*[A-Za-z_$][\w$.]*\.category\s*\}/;
		expect(bareInterpolation.test('<Badge>{expense.category}</Badge>')).toBe(true);
		expect(bareInterpolation.test('{ currentConflict.localExpense.category }')).toBe(true);
		expect(bareInterpolation.test('{getCategoryLabel(expense.category)}')).toBe(false);
		expect(bareInterpolation.test('{categoryLabels[expense.category]}')).toBe(false);
		// An attribute binding passes the value on; it is not a rendered label.
		expect(bareInterpolation.test('<Select value={row.category} />')).toBe(false);
	});
});

describe('one category → icon assignment', () => {
	test('the assignment is the picker\u2019s six distinct icons', () => {
		expect(Object.keys(CATEGORY_ICONS).sort()).toEqual([...ALL_CATEGORIES].sort());
		// The drift this replaced: regulatory/enhancement/misc all shared one icon in the helper
		// while the picker gave each its own, so the icon a user picked was not the icon the table
		// showed. Distinctness IS the design — the icon is how a category column is scanned.
		expect(new Set(ALL_CATEGORIES.map(category => CATEGORY_ICONS[category])).size).toBe(6);
	});

	test('getCategoryIcon derives from the one assignment', () => {
		for (const category of ALL_CATEGORIES) {
			expect(getCategoryIcon(category), `icon → ${category}`).toBe(CATEGORY_ICONS[category]);
		}
	});

	test('the form\u2019s category picker derives its icons from the same assignment', () => {
		// The picker is where the second icon map lived. It must call the shared getter, not carry
		// its own icon per entry.
		expect(CATEGORY_SELECTOR_SOURCE).toContain('getCategoryIcon(category.value)');
	});

	test('no second category → icon map exists anywhere under src', () => {
		// Shape 1: a per-category key pointing straight at a component (`fuel: Fuel`).
		const keyedMap = findPerCategoryEntries(ICON_VALUE_PATTERN, ICON_HOME);

		// Shape 2: the picker's shape — an entry object that pairs a category value with its own
		// icon. `icon:` alone is far too common to flag (every stat-card grid uses it), so this
		// looks only at object literals keyed by a category string.
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
		// Both scans are regex-shaped, so pin that they match the real duplicates. Without this a
		// typo'd pattern would make the test above pass over anything.
		const keyedMap = new RegExp(
			`^\\s*'?(?:${CATEGORY_ALTERNATION})'?:\\s*${ICON_VALUE_PATTERN}`
		);
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
		// Badge classes vs a CSS color value — the two contracts that used to share the name
		// `getCategoryColor` one import apart.
		expect(getCategoryBadgeClasses('fuel')).toBe('text-chart-1 bg-chart-1/10');
		expect(getCategoryChartColor('fuel')).toBe('var(--chart-1)');
	});

	test('the deprecated getCategoryColor aliases still point at their replacements', () => {
		// They exist only until the remaining call sites are renamed; re-pointing either one at
		// the other module's helper would silently swap classes for a CSS color.
		expect(deprecatedBadgeClassesAlias).toBe(getCategoryBadgeClasses);
		expect(deprecatedChartColorAlias).toBe(getCategoryChartColor);
	});
});

describe('StatCard icon tokens cover the theme', () => {
	test('every --chart-N token app.css defines is a StatCard icon token', () => {
		const themeTokens = new Set(
			[...APP_CSS.matchAll(/--chart-(\d+)\s*:/g)].map(match => `chart-${match[1]}`)
		);
		// The scan is live, not a no-op over a renamed/moved stylesheet.
		expect(themeTokens.size).toBeGreaterThan(4);

		// StatCard spells every token out as a single-quoted literal, in both the type union and
		// the class map (Tailwind only resolves complete class strings).
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
		// @ts-expect-error 'chart-9' is not a --chart-N token the theme defines. If this stops
		// erroring, StatCardIconColor has been widened back to `string` and typos go silent again.
		const outOfRange: StatCardIconColor = 'chart-9';
		expect(outOfRange).toBe('chart-9');

		const inRange: StatCardIconColor = 'chart-8';
		expect(inRange).toBe('chart-8');
	});
});
