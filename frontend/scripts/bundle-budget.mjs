import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const output = join(root, '.svelte-kit/output');
const budgetsFile = join(root, 'bundle-budgets.json');

if (!existsSync(join(output, 'server/manifest-full.js'))) {
	console.error('bundle-budget: no build output in .svelte-kit/output. Run `npm run build` first.');
	process.exit(1);
}

const budgets = JSON.parse(readFileSync(budgetsFile, 'utf8'));
const { manifest } = await import(pathToFileURL(join(output, 'server/manifest-full.js')).href);

const sizeCache = new Map();
function gzipSize(file) {
	if (!sizeCache.has(file)) {
		sizeCache.set(file, gzipSync(readFileSync(join(output, 'client', file))).length);
	}
	return sizeCache.get(file);
}

function nodeImports(index) {
	const source = readFileSync(join(output, `server/nodes/${index}.js`), 'utf8');
	const match = source.match(/export const imports = (\[[^\]]*\]);/);
	return match ? JSON.parse(match[1]) : [];
}

const total = files => [...files].reduce((sum, file) => sum + gzipSize(file), 0);
const kb = bytes => bytes / 1024;

const shared = new Set(manifest.client.imports);
for (const file of nodeImports(0)) shared.add(file);

const rows = [
	{ route: 'shared entry + root layout', size: kb(total(shared)), budget: budgets.shared }
];
for (const route of manifest.routes) {
	if (!route.page) continue;
	const files = new Set();
	for (const index of [...route.page.layouts, route.page.leaf]) {
		if (index === undefined) continue;
		for (const file of nodeImports(index)) if (!shared.has(file)) files.add(file);
	}
	rows.push({
		route: route.id,
		size: kb(total(files)),
		budget: budgets.routes[route.id] ?? budgets.default
	});
}

const unknown = Object.keys(budgets.routes).filter(id => !rows.some(row => row.route === id));
const over = rows.filter(row => row.size > row.budget);

const width = Math.max(...rows.map(row => row.route.length));
console.log(`${'Route'.padEnd(width)}  gzip KB  budget  status`);
for (const row of rows) {
	const status = row.size > row.budget ? 'OVER' : 'ok';
	console.log(
		`${row.route.padEnd(width)}  ${row.size.toFixed(1).padStart(7)}  ${String(row.budget).padStart(6)}  ${status}`
	);
}

if (unknown.length > 0) {
	console.error(`\nbundle-budget: budgets name routes that no longer exist: ${unknown.join(', ')}`);
}
if (over.length > 0) {
	console.error(
		`\nbundle-budget: ${over.length} route(s) over budget. Shrink the route, or raise its budget in bundle-budgets.json and say why in the PR.`
	);
}
if (unknown.length > 0 || over.length > 0) process.exit(1);
