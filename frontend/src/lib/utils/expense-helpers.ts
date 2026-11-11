import type { ExpenseCategory, SplitConfig } from '$lib/types';
import { Coffee, CreditCard, DollarSign, FileText, Fuel, Sparkles, Wrench } from '@lucide/svelte';
import {
	CATEGORY_LABELS,
	mapCategoryColorTokens,
	type CategoryColorToken
} from '$lib/utils/chart-colors';

type LucideIcon = typeof Fuel;

export type ExpenseSortField = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

/** The minimal shape the sort comparator reads — works for a standalone expense
 *  row OR a collapsed split-group row (which supplies its own representative
 *  date/amount + the first child's id as the stable group key). */
export interface SortableRow {
	id: string;
	date: string;
	amount: number;
}

/**
 * Stable comparator for the expenses table, matching the SERVER's order exactly.
 *
 * The backend query orders by `dir(sortColumn), dir(id)` (expenses/repository.ts:287)
 * — i.e. the id tiebreaker inherits the SAME direction as the primary sort. Without a
 * tiebreaker the client sort returned 0 for equal date/amount rows, so ties fell back to
 * JS engine ordering / array-build order (the standalone-then-group concatenation in the
 * table actually reorders same-key rows vs. the server), causing a visible reshuffle on
 * pagination/refresh.
 *
 * The id is folded into the raw comparison BEFORE the asc/desc flip, so a single
 * negation carries the tiebreak in the same direction as the server (a naive
 * `|| a.id.localeCompare(b.id)` applied AFTER the flip would always break ascending and
 * diverge from the server on a desc sort).
 */
export function compareExpenseRows(
	a: SortableRow,
	b: SortableRow,
	sortBy: ExpenseSortField,
	sortOrder: SortDirection
): number {
	let comparison: number;
	if (sortBy === 'amount') {
		comparison = a.amount - b.amount;
	} else {
		comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
	}
	// Stable tiebreaker on id (same field + direction the server uses), so equal
	// date/amount rows keep a deterministic, server-consistent order.
	if (comparison === 0) {
		comparison = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	}
	return sortOrder === 'asc' ? comparison : -comparison;
}

/** A multi-vehicle split allocation row, as the expense + insurance-term forms hold it in state. */
export type SplitAllocationDraft = { vehicleId: string; amount?: number; percentage?: number };

/**
 * Reset split allocations when the split METHOD changes, for the selected vehicles. ONE source of truth
 *  for the reset both the expense form (ExpenseForm) and the insurance-term form (InsuranceTermForm)
 * ran BYTE-IDENTICAL: 'even' carries no per-vehicle rows (the backend splits evenly via largest-remainder
 * integer cents — see split-service computeEvenSplit); 'absolute' seeds each vehicle at amount 0;
 * 'percentage' seeds an even 100/N split rounded to ONE decimal. The rounding is load-bearing — a divergent
 * copy (round to 2 decimals, or a different N math) would materialize the SAME multi-vehicle split with
 * different per-vehicle percentages depending on which form created it.
 */
export function resetSplitAllocations(
	method: 'even' | 'absolute' | 'percentage',
	vehicleIds: string[]
): SplitAllocationDraft[] {
	if (method === 'even') return [];
	if (method === 'absolute') return vehicleIds.map(id => ({ vehicleId: id, amount: 0 }));
	const pct = vehicleIds.length > 0 ? 100 / vehicleIds.length : 0;
	return vehicleIds.map(id => ({ vehicleId: id, percentage: Math.round(pct * 10) / 10 }));
}

/**
 * Build the API `SplitConfig` discriminated union from a form's split state. ONE source of truth
 * for what ExpenseForm and ReminderForm ran near-byte-identical (`buildSplitConfig`): 'even' carries the
 * `vehicleIds` (the backend computes the per-vehicle even split itself); 'absolute'/'percentage' carry the
 * per-vehicle allocations, coalescing a missing draft value to 0 (the editor seeds 0/100-over-N, but a
 * cleared input is `undefined`). `ReminderSplitConfig` is structurally identical to `SplitConfig`, so a
 * reminder caller can assert the return back to its own alias. A divergent copy could drop the
 * coalesce (→ `undefined` in the payload) or mis-map a field, materializing a different per-vehicle split
 * depending on which form created it — the same drift class as resetSplitAllocations.
 */
export function buildSplitConfig(
	method: 'even' | 'absolute' | 'percentage',
	vehicleIds: string[],
	allocations: SplitAllocationDraft[]
): SplitConfig {
	if (method === 'even') return { method: 'even', vehicleIds };
	if (method === 'absolute') {
		return {
			method: 'absolute',
			allocations: allocations.map(a => ({ vehicleId: a.vehicleId, amount: a.amount ?? 0 }))
		};
	}
	return {
		method: 'percentage',
		allocations: allocations.map(a => ({ vehicleId: a.vehicleId, percentage: a.percentage ?? 0 }))
	};
}

/**
 * Category → display label under the name the table, form, and dashboard call sites use. This is
 * the SAME object as `CATEGORY_LABELS` in chart-colors.ts, not a copy, so a badge and a chart
 * legend cannot name one category two different things.
 */
export const categoryLabels: Record<ExpenseCategory, string> = CATEGORY_LABELS;

/**
 * Category → icon. The ONLY place a category is assigned an icon; the table, the activity feed,
 * the per-vehicle overview, and the form's category picker all render from this one assignment.
 *
 * It used to collapse regulatory, enhancement, and misc onto a single `DollarSign` while the
 * picker drew those same three with distinct icons, so the icon a user picked an expense under
 * was not the icon the table then showed it with. The picker's assignment won — six distinct
 * icons, because the icon is the fastest way to scan a category column.
 *
 * `Record<ExpenseCategory, …>` makes a missing entry a compile error rather than a blank cell.
 */
export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
	fuel: Fuel,
	maintenance: Wrench,
	financial: CreditCard,
	regulatory: FileText,
	enhancement: Sparkles,
	misc: Coffee
};

/**
 * Icon for a category key. A legacy or garbage value off an old row falls back to the generic
 * `DollarSign`, which is deliberately none of the six real icons.
 */
export function getCategoryIcon(category: ExpenseCategory): LucideIcon {
	return CATEGORY_ICONS[category] || DollarSign;
}

/**
 * Badge class pair per color TOKEN rather than per category: the category → token assignment lives
 * once, in `CATEGORY_COLOR_TOKENS` (chart-colors.ts), so a badge physically cannot drift from the
 * chart color the way the two old hand-written category maps did.
 *
 * Tailwind resolves utilities by scanning source text for complete class strings, so each pair is
 * spelled out — a `text-${token}` template would type-check and then render unstyled.
 *
 * `Record<CategoryColorToken, …>` is the exhaustiveness guard: pointing a category at a token with
 * no entry here fails the build.
 */
const BADGE_CLASSES_BY_TOKEN: Record<CategoryColorToken, string> = {
	'chart-1': 'text-chart-1 bg-chart-1/10',
	'chart-2': 'text-chart-2 bg-chart-2/10',
	'chart-3': 'text-chart-3 bg-chart-3/10',
	'chart-4': 'text-chart-4 bg-chart-4/10',
	'chart-5': 'text-chart-5 bg-chart-5/10',
	// A badge tint sits behind small text, so the neutral bucket takes the de-emphasized
	// `--muted-foreground` on `--muted` instead of the chart's high-contrast `--primary`.
	neutral: 'text-muted-foreground bg-muted'
};

const CATEGORY_BADGE_CLASSES = mapCategoryColorTokens(token => BADGE_CLASSES_BY_TOKEN[token]);

/** Pair used for a category key outside the union — a legacy or garbage value off an old row. */
const UNKNOWN_CATEGORY_BADGE_CLASSES = BADGE_CLASSES_BY_TOKEN.neutral;

/**
 * Tailwind class pair (`text-*` plus a 10% `bg-*` tint) for an expense-category badge — the
 * expenses table, the dashboard activity feed, the per-vehicle expense overview.
 *
 * For a chart fill use `getCategoryChartColor` from chart-colors.ts: same tokens, rendered as a
 * CSS color value instead of classes.
 */
export function getCategoryBadgeClasses(category: ExpenseCategory): string {
	return CATEGORY_BADGE_CLASSES[category] || UNKNOWN_CATEGORY_BADGE_CLASSES;
}

/**
 * @deprecated Ambiguous name — chart-colors.ts exported its own `getCategoryColor` returning a CSS
 * color value, so two functions one import apart shared a name and had incompatible return
 * contracts. Use {@link getCategoryBadgeClasses}. This alias exists only until the remaining badge
 * call sites are renamed.
 */
export const getCategoryColor = getCategoryBadgeClasses;
