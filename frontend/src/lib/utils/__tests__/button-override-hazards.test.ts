/**
 * Regression GUARD for the three ways a call site silently breaks a kit `<Button>` — each of which
 * looks perfectly fine in the editor, and in the one mode/width the author happened to look at.
 *
 * 1. NO ACCESSIBLE NAME BELOW `sm`. The floating action bars hide their button text with
 *    `class="hidden sm:inline"` so only the icon shows on a phone. Every Lucide icon renders
 *    `aria-hidden="true"`, so `display: none` on the text leaves the button with an EMPTY
 *    accessible name — axe `button-name`, critical — and a screen-reader user gets two adjacent
 *    unnamed "button"s where one deletes and one dismisses. `max-sm:sr-only` clips the label
 *    instead of removing it: identical geometry, name intact, and ONE name source (no `aria-label`
 *    to drift out of sync with the visible text). Mobile is this app's primary form factor.
 *
 * 2. `sr-only sm:not-sr-only`, THE FIX THAT LOOKS RIGHT AND IS NOT. A second, later `.sr-only`
 *    rule (the legacy `clip: rect(…)` one) is emitted after `.sm:not-sr-only` in this project's
 *    stylesheet, and at equal specificity the later rule wins — so the label stays clipped at EVERY
 *    width and silently disappears from the desktop UI. Measured in the browser, not assumed. Gate
 *    the `sr-only` itself with `max-sm:` rather than trying to undo it above the breakpoint.
 *
 * 3. A BACKGROUND OVERRIDE ON `variant="outline"` THAT ONLY APPLIES IN LIGHT MODE. The outline
 *    variant ships `bg-background` AND `dark:bg-input/30`. tailwind-merge only drops classes that
 *    conflict within the same modifier group, so a bare `bg-*` in the call site's `class` replaces
 *    `bg-background` and leaves `dark:bg-input/30` standing: in dark mode the button paints the
 *    variant's near-black surface while the overridden foreground stays — which is how the expense
 *    form's Cancel button reached 1.08:1, a black X on a black pill, invisible. Either theme the
 *    button through its variant, or supply both modes.
 *
 * Scans the committed sources, so it travels with the repo and covers the whole class rather than
 * today's instances. Runs in the fast unit suite — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three dirs up from __tests__'s parent.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Call sites still hiding a button label with `hidden sm:*`, pending conversion to
 * `max-sm:sr-only`. `hidden` is `display:none`, which removes the label from the accessibility
 * tree, so an icon-only button below the `sm` breakpoint ends up with no accessible name at all.
 * Empty means every call site is converted; an entry here is a live axe `button-name` violation.
 */
const KNOWN_DEBT = new Set<string>([]);

interface Element {
	/** The opening tag, from `<Button` through its closing `>`. */
	tag: string;
	/** Everything between the opening tag and the matching close tag. */
	body: string;
	line: number;
}

/**
 * Find every `<Button …>…</Button>` in a Svelte source. Hand-written rather than regex-matched
 * because an attribute value can contain `>` (`onclick={() => …}`), so the opening tag ends at the
 * first `>` that is outside both quotes and braces.
 */
function findButtons(src: string): Element[] {
	const found: Element[] = [];
	const OPEN = '<Button';
	let from = 0;
	let at = src.indexOf(OPEN, from);

	while (at !== -1) {
		// Skip `<ButtonGroup`-style neighbours: a name continues if the next char is a name char.
		if (/[\w-]/.test(src[at + OPEN.length] ?? '')) {
			from = at + OPEN.length;
			at = src.indexOf(OPEN, from);
			continue;
		}

		let end = at + OPEN.length;
		let braces = 0;
		let quote: string | null = null;
		for (; end < src.length; end++) {
			const char = src[end];
			if (quote) {
				if (char === quote) quote = null;
				continue;
			}
			if (char === '"' || char === "'") quote = char;
			else if (char === '{') braces++;
			else if (char === '}') braces--;
			else if (char === '>' && braces === 0) break;
		}

		const tag = src.slice(at, end + 1);
		const close = src.indexOf('</Button>', end);
		found.push({
			tag,
			body: tag.endsWith('/>') || close === -1 ? '' : src.slice(end + 1, close),
			line: src.slice(0, at).split('\n').length
		});

		from = end + 1;
		at = src.indexOf(OPEN, from);
	}

	return found;
}

/** A label the browser REMOVES below `sm` (`display:none`), taking the accessible name with it. */
const DISPLAY_HIDDEN_LABEL = /class="[^"]*\bhidden\b[^"]*\bsm:(?:inline|block|flex)\b[^"]*"/;
/** A bare (unmodified) background utility in the call site's own class list. */
const BARE_BG = /(?:^|\s)(bg-[a-z][^\s]*)/;

const files = collectSvelteFiles(SRC_ROOT);
const buttons = files.flatMap(file => {
	const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
	return findButtons(readFileSync(file, 'utf-8')).map(el => ({ ...el, rel }));
});

describe('kit Button call sites', () => {
	test('the scan actually parsed Buttons out of the sources (guard is live, not a no-op)', () => {
		// If either of these collapses to 0 the parser broke and both checks below are vacuous.
		expect(files.length).toBeGreaterThan(20);
		expect(buttons.length).toBeGreaterThan(50);

		// The pattern must still match the shape it exists to catch. This is asserted against a
		// synthetic fixture rather than the live tree on purpose: every real call site has been
		// converted, so a tree-based probe would be unsatisfiable at zero debt — which would force
		// whoever fixed the last one to weaken the guard to land their fix.
		expect(
			DISPLAY_HIDDEN_LABEL.test('<span class="hidden sm:inline font-semibold">Delete</span>')
		).toBe(true);
		expect(
			DISPLAY_HIDDEN_LABEL.test('<span class="max-sm:sr-only font-semibold">Delete</span>')
		).toBe(false);
	});

	test('every Button keeps an accessible name below the `sm` breakpoint', () => {
		const offenders = buttons
			.filter(b => DISPLAY_HIDDEN_LABEL.test(b.body) && !/\baria-label\b/.test(b.tag))
			.filter(b => !KNOWN_DEBT.has(b.rel))
			.map(b => `${b.rel}:${b.line}`);

		expect(
			offenders,
			"Icon-only at mobile width with no accessible name (axe button-name). Swap the label span's " +
				'`hidden sm:inline` for `max-sm:sr-only` so the name survives where the text does not:\n' +
				offenders.join('\n')
		).toEqual([]);
	});

	test('no label tries to undo `sr-only` above a breakpoint (a later rule wins, hiding it always)', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
			readFileSync(file, 'utf-8')
				.split('\n')
				.forEach((line, i) => {
					const classes = line.match(/class="([^"]*)"/)?.[1];
					if (!classes) return;
					// `sr-only` unmodified in the same list as any `*:not-sr-only` reveal.
					if (/(?:^|\s)sr-only(?:\s|$)/.test(classes) && /not-sr-only/.test(classes)) {
						offenders.push(`${rel}:${i + 1}`);
					}
				});
		}

		expect(
			offenders,
			'`sr-only` plus a `*:not-sr-only` reveal does NOT reveal anything here: a later `.sr-only` ' +
				'rule in the bundled stylesheet outranks the reveal, so the text stays clipped at every ' +
				'width. Gate the sr-only itself instead (e.g. `max-sm:sr-only`):\n' +
				offenders.join('\n')
		).toEqual([]);
	});

	test('no outline-variant Button overrides its background for light mode only', () => {
		const offenders: string[] = [];
		for (const button of buttons) {
			if (!/variant="outline"/.test(button.tag)) continue;
			const classes = button.tag.match(/class="([^"]*)"/)?.[1] ?? '';
			if (/dark:bg-/.test(classes)) continue;
			const bare = classes.match(BARE_BG);
			if (bare) offenders.push(`${button.rel}:${button.line} → ${bare[1]}`);
		}

		expect(
			offenders,
			'A bare `bg-*` on `variant="outline"` leaves the variant\'s own `dark:bg-input/30` in place, ' +
				'so the override applies in light mode only and dark mode paints a different surface than ' +
				'the chosen foreground expects. Theme it through the variant, or set both modes:\n' +
				offenders.join('\n')
		).toEqual([]);
	});

	test('every KNOWN_DEBT entry still exists (no stale allowlist)', () => {
		const missing = [...KNOWN_DEBT].filter(rel => {
			try {
				readFileSync(join(SRC_ROOT, rel), 'utf-8');
				return false;
			} catch {
				return true;
			}
		});

		expect(missing, `Stale KNOWN_DEBT entr(ies) — remove them:\n${missing.join('\n')}`).toEqual([]);
	});
});
