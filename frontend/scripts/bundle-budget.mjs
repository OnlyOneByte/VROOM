import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, '.svelte-kit/output');
const budgetsFile = join(root, 'bundle-budgets.json');

if (!existsSync(join(output, 'server/manifest-full.js'))) {
	console.error('bundle-budget: no build output in .svelte-kit/output. Run `npm run build` first.');
	process.exit(1);
}

const budgets = JSON.parse(readFileSync(budgetsFile, 'utf8'));
const missing = ['shared', 'fonts', 'default'].filter(key => typeof budgets[key] !== 'number');
if (missing.length > 0) {
	console.error(`bundle-budget: bundle-budgets.json has no number for ${missing.join(', ')}.`);
	process.exit(1);
}
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
	if (!match) {
		console.error(
			`bundle-budget: server/nodes/${index}.js has no imports list. The SvelteKit build format changed; update this script.`
		);
		process.exit(1);
	}
	return JSON.parse(match[1]);
}

const viteManifest = JSON.parse(readFileSync(join(output, 'client/.vite/manifest.json'), 'utf8'));

function chunkGraph(source) {
	if (!viteManifest[source]) {
		console.error(
			`bundle-budget: firstView names ${source}, which is not a chunk in this build. Update bundle-budgets.json.`
		);
		process.exit(1);
	}
	const files = new Set();
	const visit = key => {
		const entry = viteManifest[key];
		if (!entry || files.has(entry.file)) return;
		files.add(entry.file);
		for (const dependency of entry.imports ?? []) visit(dependency);
	};
	visit(source);
	return files;
}

const total = files => [...files].reduce((sum, file) => sum + gzipSize(file), 0);
const kb = bytes => bytes / 1024;

const shared = new Set(manifest.client.imports);
for (const file of nodeImports(0)) shared.add(file);

const fontsDir = join(root, 'static/fonts');
const fontBytes = existsSync(fontsDir)
	? readdirSync(fontsDir)
			.filter(name => name.endsWith('.woff2'))
			.reduce((sum, name) => sum + statSync(join(fontsDir, name)).size, 0)
	: 0;

const rows = [
	{ route: 'shared entry + root layout', size: kb(total(shared)), budget: budgets.shared },
	{ route: 'fonts (woff2, as served)', size: kb(fontBytes), budget: budgets.fonts }
];
function routeFiles(route, firstView) {
	const files = new Set();
	for (const index of [...route.page.layouts, route.page.leaf]) {
		if (index === undefined) continue;
		for (const file of nodeImports(index)) if (!shared.has(file)) files.add(file);
	}
	for (const source of firstView) {
		for (const file of chunkGraph(source)) if (!shared.has(file)) files.add(file);
	}
	return files;
}

for (const route of manifest.routes) {
	if (!route.page) continue;
	rows.push({
		route: route.id,
		size: kb(total(routeFiles(route, budgets.firstView?.[route.id] ?? []))),
		budget: budgets.routes[route.id] ?? budgets.default
	});
}

for (const [name, view] of Object.entries(budgets.views ?? {})) {
	const route = manifest.routes.find(r => r.id === view.route && r.page);
	if (!route) {
		console.error(`bundle-budget: view "${name}" names route ${view.route}, which has no page.`);
		process.exit(1);
	}
	rows.push({
		route: name,
		size: kb(total(routeFiles(route, view.firstView))),
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
