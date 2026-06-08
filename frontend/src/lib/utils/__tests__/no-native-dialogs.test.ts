/**
 * Regression GUARD (committed, travels with the merge) for the native-dialog class.
 *
 * Native browser confirm()/alert() are UNDER-DISCLOSING: a confirm() can only show one
 * line, so it can't surface a destructive cascade ("this also deletes 3 photos"), and an
 * alert() is an unstyled blocking modal. Cycles 89–91 + 195 migrated every one of these
 * to the kit's ConfirmDialog (AlertDialog-based, disclosing, async, themed). The codebase
 * is now at ZERO native dialog calls. This pins it there: under autonomous development a
 * future cycle could add a raw confirm() and silently regress the disclosure-quality bar,
 * and the e2e harness wouldn't catch it (a confirm() auto-dismisses headlessly).
 *
 * Scans every .svelte/.ts source for a confirm()/alert() CALL (optionally window.-prefixed).
 * The match is deliberately call-shaped and not preceded by a word char or dot, so the
 * many legitimate uses of these WORDS — the <Alert>/<AlertDialog> kit components,
 * role="alert", "Review and confirm" copy, showDeleteConfirm state, etc. — never match.
 * prompt() is intentionally NOT scanned: its only occurrence is a TS method signature on
 * the PWA BeforeInstallPromptEvent interface (a real browser API, not the native dialog).
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up from dirname.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// A confirm()/alert() CALL, optionally window.-prefixed, NOT preceded by a word char or
// dot (so AlertDialog, foo.confirm, confirmAction, role="alert" never match) and NOT a
// property/key like `confirm:`. Whitespace allowed before the paren.
const NATIVE_DIALOG_CALL = /(?<![\w.])(?:window\s*\.\s*)?(?:confirm|alert)\s*\(/;

// Strip comments before scanning so DOCUMENTATION mentioning confirm()/alert() (e.g.
// "replaces native confirm()") isn't a false positive. Handles all three shapes a
// mention could hide in: /* ... */ block spans (incl. multi-line), JSDoc " * " body
// lines, and // line comments. URLs ("://") are preserved.
function stripComments(source: string): string {
	// Remove block-comment spans wholesale (so /** … confirm() … */ JSDoc is gone).
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
	return withoutBlocks
		.split('\n')
		.map((line) => {
			const trimmed = line.trimStart();
			// JSDoc continuation line ("* …") left over from a partial strip — drop it.
			if (trimmed.startsWith('*')) return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line; // keep URLs
			return line.slice(0, idx);
		})
		.join('\n');
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectSourceFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('no native confirm()/alert() dialogs (use ConfirmDialog — cycle 89/195 class guard)', () => {
	const files = collectSourceFiles(SRC_ROOT);

	test('the scan actually found sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no source file calls native confirm()/alert()', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			// The guard test itself contains the pattern in strings/comments — skip it.
			if (rel.endsWith('__tests__/no-native-dialogs.test.ts')) continue;

			// Strip comments across the whole file first (block comments span lines),
			// then scan the cleaned lines so we can still report the original line number.
			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (NATIVE_DIALOG_CALL.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Native confirm()/alert() call(s) found — use the disclosing ConfirmDialog primitive (src/lib/components/common/ConfirmDialog.svelte) instead, so destructive cascades are surfaced (cycle 89/195):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
