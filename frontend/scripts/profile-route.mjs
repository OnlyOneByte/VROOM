// Throwaway: CPU-profiles cold loads of one route at 375x812, 4x CPU, and attributes time to source via build sourcemaps.
// env: VITALS_SESSION, PROFILE_PATH, PROFILE_RUNS (default 5). Needs a build with sourcemaps served on 4173.
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { SourceMapConsumer } from 'source-map-js';

const path = process.env.PROFILE_PATH;
const runs = Number(process.env.PROFILE_RUNS ?? 5);
const base = 'http://127.0.0.1:4173';
const out = new URL('../.svelte-kit/output/client', import.meta.url).pathname;
const maps = new Map();
function consumer(url) {
	if (!maps.has(url)) {
		const p = out + new URL(url).pathname + '.map';
		maps.set(url, existsSync(p) ? new SourceMapConsumer(JSON.parse(readFileSync(p, 'utf8'))) : null);
	}
	return maps.get(url);
}
function where(cf) {
	if (!cf.url.startsWith(base)) return null;
	const o = consumer(cf.url)?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
	if (!o?.source) return null;
	const s = o.source.replace(/^(\.\.\/)+/, '');
	const nm = s.match(/node_modules\/((@[^/]+\/)?[^/]+)\/(.*)/);
	const file = nm ? `${nm[1]}/${nm[3]}` : s.replace(/^.*?src\//, 'src/');
	return { file, fn: `${file}:${o.line} ${o.name ?? cf.functionName ?? ''}` };
}

const browser = await chromium.launch();
const self = new Map();
const incl = new Map();
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
for (let i = 0; i < runs; i++) {
	const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true });
	await ctx.addCookies([{ name: 'auth_session', value: process.env.VITALS_SESSION, domain: '127.0.0.1', path: '/' }]);
	const page = await ctx.newPage();
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
	await cdp.send('Profiler.start');
	await page.goto(base + path, { waitUntil: 'networkidle', timeout: 120000 });
	await page.waitForTimeout(1500);
	const { profile } = await cdp.send('Profiler.stop');
	await ctx.close();
	const byId = new Map(profile.nodes.map(n => [n.id, n]));
	const parent = new Map();
	for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
	const cache = new Map();
	const at = id => {
		if (!cache.has(id)) cache.set(id, where(byId.get(id).callFrame));
		return cache.get(id);
	};
	profile.samples.forEach((id, k) => {
		const ms = (profile.timeDeltas[k] ?? 0) / 1000 / runs;
		const name = byId.get(id).callFrame.functionName;
		if (name === '(idle)') return;
		const own = at(id);
		add(self, own ? own.fn : `(${name || 'native'})`, ms);
		const seen = new Set();
		for (let n = id; n !== undefined; n = parent.get(n)) {
			const w = at(n);
			if (w && w.file.startsWith('src/')) seen.add(w.file);
		}
		for (const f of seen) add(incl, f, ms);
	});
}
await browser.close();
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `| ${v.toFixed(1)} | \`${k}\` |`);
const md = [
	`Profile of ${path}, ${runs} cold loads, 375x812, 4x CPU. ms per load (throttled).`,
	'',
	'Self time by function:',
	'',
	'| ms | function |',
	'|---|---|',
	...top(self, 50),
	'',
	'Inclusive time by app source file (counted once per sample):',
	'',
	'| ms | file |',
	'|---|---|',
	...top(incl, 40)
].join('\n');
writeFileSync('profile.md', md + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md);
