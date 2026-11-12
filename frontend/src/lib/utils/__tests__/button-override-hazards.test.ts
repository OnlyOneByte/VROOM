import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';
import { ratchet } from './_helpers/debt-ratchet';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const KNOWN_DEBT: string[] = [];

interface Element {
	tag: string;
	body: string;
	line: number;
}

function findButtons(src: string): Element[] {
	const found: Element[] = [];
	const OPEN = '<Button';
	let from = 0;
	let at = src.indexOf(OPEN, from);

	while (at !== -1) {
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

const DISPLAY_HIDDEN_LABEL = /class="[^"]*\bhidden\b[^"]*\bsm:(?:inline|block|flex)\b[^"]*"/;
const BARE_BG = /(?:^|\s)(bg-[a-z][^\s]*)/;

const files = collectSvelteFiles(SRC_ROOT);
const buttons = files.flatMap(file => {
	const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
	return findButtons(readFileSync(file, 'utf-8')).map(el => ({ ...el, rel }));
});

const unnamedAtMobile = buttons.filter(
	b => DISPLAY_HIDDEN_LABEL.test(b.body) && !/\baria-label\b/.test(b.tag)
);

ratchet({
	name: 'every kit Button keeps an accessible name below the `sm` breakpoint',
	tolerated: KNOWN_DEBT,
	guidance:
		"Icon-only at mobile width with no accessible name (axe button-name). Swap the label span's " +
		'`hidden sm:inline` for `max-sm:sr-only` so the name survives where the text does not:\n' +
		`${unnamedAtMobile.map(b => `${b.rel}:${b.line}`).join('\n')}\nOffending files:`,
	scan: () => unnamedAtMobile.map(b => b.rel),
	probe: () => {
		expect(
			DISPLAY_HIDDEN_LABEL.test('<span class="hidden sm:inline font-semibold">Delete</span>')
		).toBe(true);
		expect(
			DISPLAY_HIDDEN_LABEL.test('<span class="max-sm:sr-only font-semibold">Delete</span>')
		).toBe(false);
		expect(files.length, 'the .svelte walk found almost nothing').toBeGreaterThan(20);
		expect(buttons.length, 'the Button parser found almost nothing').toBeGreaterThan(50);
	}
});

describe('kit Button call sites', () => {
	test('no label tries to undo `sr-only` above a breakpoint (a later rule wins, hiding it always)', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
			readFileSync(file, 'utf-8')
				.split('\n')
				.forEach((line, i) => {
					const classes = line.match(/class="([^"]*)"/)?.[1];
					if (!classes) return;
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
});
