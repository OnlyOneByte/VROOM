import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HTML_TAG = /\{\s*@html\b/;

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
	return withoutBlocks
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('*')) return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line;
			return line.slice(0, idx);
		})
		.join('\n');
}

function collectAssistantFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectAssistantFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			const rel = relative(SRC_ROOT, full).split('\\').join('/');
			if (
				(rel.includes('assistant') || rel.includes('routes/assistant')) &&
				!rel.endsWith('__tests__/assistant-safe-render.test.ts')
			) {
				acc.push(full);
			}
		}
	}
	return acc;
}

describe('assistant reply renders as plain text (no {@html} on untrusted model output)', () => {
	const files = collectAssistantFiles(SRC_ROOT);

	test('the scan actually found the assistant surface (guard is live, not a no-op)', () => {
		const hasPage = files.some(f =>
			f.split('\\').join('/').endsWith('routes/assistant/+page.svelte')
		);
		expect(hasPage, `assistant files scanned:\n${files.join('\n')}`).toBe(true);
	});

	test('no assistant source uses {@html} (untrusted reply must render as a text node)', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (HTML_TAG.test(line))
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
			});
		}
		expect(
			offenders,
			`{@html} found on the assistant surface — the reply is UNTRUSTED model output and must render as a plain-text node (whitespace-pre-wrap), never raw HTML:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
