/**
 * Every third-party package app code imports must be declared in package.json.
 *
 * npm hoists the whole transitive tree into a flat `node_modules`, so an import of a package this
 * app never declared resolves anyway — as long as some dependency-of-a-dependency happens to pull it
 * in at a compatible version. That is a phantom dependency: the build works today and breaks on an
 * unrelated bump, with a package.json that looks fully satisfied so the cause is non-obvious. It also
 * leaves the version the app compiles against entirely unpinned.
 *
 * This test walks the real import graph of `src/` and `e2e/` and asserts each bare specifier's
 * package root is declared, so a phantom import fails here rather than in someone's next upgrade.
 */

import { builtinModules } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// `node:path` rather than the global `URL`: the test environment is happy-dom, whose URL
// implementation does not resolve a relative path against a `file://` base the way Node's does.
const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED_DIRS = ['src', 'e2e'];
const SCANNED_EXTENSIONS = ['.ts', '.js', '.mjs', '.svelte'];

/**
 * Specifiers that are resolved by the toolchain rather than by `node_modules`, so they have no
 * package.json entry to find: SvelteKit's own aliases, Node builtins, and Vite virtual modules.
 */
const TOOLCHAIN_PREFIXES = ['$lib', '$app/', '$env/', '$service-worker', 'virtual:'];
const NODE_BUILTINS = new Set(builtinModules);

function listFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listFiles(full));
		else if (SCANNED_EXTENSIONS.some(ext => entry.endsWith(ext))) out.push(full);
	}
	return out;
}

/**
 * Comments are stripped before scanning, so prose that happens to read like an import
 * ("...derived from 'the other table'") is not mistaken for one. `//` preceded by `:` is left
 * alone so URLs inside code survive.
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** `import`/`export ... from 'x'`, bare `import 'x'`, and dynamic `import('x')`. */
const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|^[ \t]*import\s+)['"]([^'"\n]+)['"]/gm;

/** A specifier that is at least shaped like a package path — rules out prose caught by the regex. */
const PACKAGE_SPECIFIER = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[^'"]*)?$/;

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
function packageRoot(specifier: string): string {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function isThirdParty(specifier: string): boolean {
	if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
	if (TOOLCHAIN_PREFIXES.some(prefix => specifier.startsWith(prefix))) return false;
	if (specifier.startsWith('node:')) return false;
	if (!PACKAGE_SPECIFIER.test(specifier)) return false;
	return !NODE_BUILTINS.has(packageRoot(specifier));
}

/** package root -> the files importing it, for a failure message that names the call site. */
function collectImports(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const dir of SCANNED_DIRS) {
		for (const file of listFiles(join(FRONTEND_ROOT, dir))) {
			const source = stripComments(readFileSync(file, 'utf8'));
			for (const match of source.matchAll(SPECIFIER_PATTERN)) {
				const specifier = match[1];
				if (!specifier || !isThirdParty(specifier)) continue;
				const root = packageRoot(specifier);
				const callers = found.get(root) ?? [];
				callers.push(file.slice(FRONTEND_ROOT.length + 1));
				found.set(root, callers);
			}
		}
	}
	return found;
}

const manifest = JSON.parse(readFileSync(join(FRONTEND_ROOT, 'package.json'), 'utf8')) as {
	name: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};
const declared = new Set([
	manifest.name,
	...Object.keys(manifest.dependencies ?? {}),
	...Object.keys(manifest.devDependencies ?? {})
]);
const imported = collectImports();

describe('third-party imports are declared in package.json', () => {
	test('the scan found the import graph (so the cases below cannot vacuously pass)', () => {
		// A sanity floor plus two packages that must always be found: one app dependency and one
		// test-only dependency. If the scanner silently stops matching, these go red.
		expect(imported.size).toBeGreaterThan(10);
		expect(imported.has('svelte')).toBe(true);
		expect(imported.has('vitest')).toBe(true);
	});

	test.each([...imported.keys()].sort())('%s is declared', pkg => {
		expect(declared.has(pkg), `${pkg} imported by ${imported.get(pkg)?.join(', ')}`).toBe(true);
	});
});
