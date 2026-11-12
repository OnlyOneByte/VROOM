import { builtinModules } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED_DIRS = ['src', 'e2e'];
const SCANNED_EXTENSIONS = ['.ts', '.js', '.mjs', '.svelte'];

const TOOLCHAIN_PREFIXES = ['#lib', '$app/', 'virtual:'];
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

function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|^[ \t]*import\s+)['"]([^'"\n]+)['"]/gm;

const PACKAGE_SPECIFIER = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[^'"]*)?$/;

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
		expect(imported.size).toBeGreaterThan(10);
		expect(imported.has('svelte')).toBe(true);
		expect(imported.has('vitest')).toBe(true);
	});

	test.each([...imported.keys()].sort())('%s is declared', pkg => {
		expect(declared.has(pkg), `${pkg} imported by ${imported.get(pkg)?.join(', ')}`).toBe(true);
	});
});
