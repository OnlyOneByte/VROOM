/**
 * Regression GUARD (committed, travels with the merge) for the assistant reply XSS-safety invariant (R8).
 *
 * The LLM assistant renders UNTRUSTED model output (the reply text comes from a third-party LLM the user
 * configured). design §8.8 + the T6 build pin the safe floor: the reply is rendered as a PLAIN-TEXT node
 * (`whitespace-pre-wrap`), NEVER via Svelte's `{@html}` (which injects raw markup → script execution).
 * Under autonomous development a future cycle could "improve" the chat by piping the reply through a
 * markdown-to-HTML step and `{@html}`-ing it — silently reopening the XSS class — and a headless e2e would
 * not necessarily catch a stored-prompt-injection payload. This guard pins it: the assistant page (and any
 * future assistant component) must contain ZERO `{@html}`.
 *
 * Scoped to the assistant surface (the route page + any src/lib component whose path mentions "assistant")
 * rather than the whole tree, because other parts of the app may legitimately use {@html} for trusted,
 * app-authored content. If the assistant grows a dedicated component dir, this scan picks it up by path.
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up from dirname.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Svelte's raw-HTML injection tag. Any whitespace between `{` and `@html` still matches. */
const HTML_TAG = /\{\s*@html\b/;

/**
 * Strip comments before scanning so DOCUMENTATION that mentions `{@html}` (this file's own header copy,
 * a Svelte `<!-- -->` note, a JS // line) is not a false positive — only a LIVE `{@html}` should match.
 * Handles JS block/line comments, JSDoc continuation lines, and HTML/Svelte `<!-- ... -->` spans.
 */
function stripComments(source: string): string {
  const withoutBlocks = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // JS block comments (incl. JSDoc)
    .replace(/<!--[\s\S]*?-->/g, ' '); // HTML / Svelte comments
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('*')) return ''; // leftover JSDoc continuation line
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      if (idx > 0 && line[idx - 1] === ':') return line; // keep URLs (https://)
      return line.slice(0, idx);
    })
    .join('\n');
}

/** Collect .svelte/.ts files whose path identifies them as part of the assistant surface. */
function collectAssistantFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
      collectAssistantFiles(full, acc);
    } else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
      const rel = relative(SRC_ROOT, full).split('\\').join('/');
      // The assistant route page + any lib file/dir named for the assistant. Exclude this guard itself
      // and the service client (no rendering there).
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

describe('assistant reply renders SAFE (no {@html} on untrusted model output — R8 class guard)', () => {
  const files = collectAssistantFiles(SRC_ROOT);

  test('the scan actually found the assistant surface (guard is live, not a no-op)', () => {
    // The /assistant route page must exist for this guard to mean anything.
    const hasPage = files.some((f) => f.split('\\').join('/').endsWith('routes/assistant/+page.svelte'));
    expect(hasPage, `assistant files scanned:\n${files.join('\n')}`).toBe(true);
  });

  test('no assistant source uses {@html} (untrusted reply must render as a text node)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      // Strip comments first (block comments span lines), then scan the cleaned lines while still
      // reporting the original line text/number.
      const rawLines = readFileSync(file, 'utf8').split('\n');
      const cleanLines = stripComments(rawLines.join('\n')).split('\n');
      cleanLines.forEach((line, idx) => {
        if (HTML_TAG.test(line)) offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
      });
    }
    expect(
      offenders,
      `{@html} found on the assistant surface — the reply is UNTRUSTED model output and must render as a plain-text node (whitespace-pre-wrap), never raw HTML (design §8.8, R8):\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
