// Throwaway A/B: interleaved cold loads of the same route on two servers, as web-vitals.mjs measures them.
// env: VITALS_SESSION, VITALS_VEHICLE_ID, AB_PAIRS (default 5). Servers: A on 4173, B on 4174.
import { appendFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const pairs = Number(process.env.AB_PAIRS ?? 5);
const session = process.env.VITALS_SESSION;
const vehicleId = process.env.VITALS_VEHICLE_ID;
const servers = { A: 4173, B: 4174 };
const routes = [
	['Dashboard', '/dashboard'],
	['Vehicle page', `/vehicles/${vehicleId}`],
	['Analytics', '/analytics'],
	['All Expenses', '/expenses'],
	['Add Expense', '/expenses/new'],
	['Add Odometer Reading', `/vehicles/${vehicleId}/odometer/new`]
];

function observe() {
	window.__v = { lcp: 0, lt: [] };
	new PerformanceObserver(l => {
		for (const e of l.getEntries()) window.__v.lcp = e.startTime;
	}).observe({ type: 'largest-contentful-paint', buffered: true });
	new PerformanceObserver(l => {
		for (const e of l.getEntries()) window.__v.lt.push([e.startTime, e.duration]);
	}).observe({ type: 'longtask', buffered: true });
}

const browser = await chromium.launch();
async function load(port, path) {
	const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true });
	await context.addCookies([{ name: 'auth_session', value: session, domain: '127.0.0.1', path: '/' }]);
	await context.addInitScript(observe);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'networkidle', timeout: 120000 });
	await page.waitForTimeout(1500);
	const v = await page.evaluate(() => {
		const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
		const tbt = window.__v.lt.reduce((s, [st, d]) => s + Math.max(0, st + d - Math.max(st + 50, fcp)), 0);
		return { lcp: window.__v.lcp, tbt, path: location.pathname };
	});
	await context.close();
	if (v.path !== path) throw new Error(`${path} on ${port} ended on ${v.path}`);
	return v;
}

const median = a => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)];
const lines = [`A/B, ${pairs} interleaved pairs per route, 375×812, 4× CPU. A = main, B = build.modulePreload false. Medians in ms.`, '', '| Route | TBT A | TBT B | B wins (TBT) | LCP A | LCP B | B wins (LCP) |', '|---|---|---|---|---|---|---|'];
const raw = {};
for (const [name, path] of routes) {
	const s = { A: [], B: [] };
	for (let i = 0; i < pairs; i++) {
		const order = i % 2 ? ['B', 'A'] : ['A', 'B'];
		for (const k of order) s[k].push(await load(servers[k], path));
	}
	raw[name] = s;
	const wins = m => s.A.filter((a, i) => s.B[i][m] < a[m]).length;
	const row = `| ${name} | ${Math.round(median(s.A.map(x => x.tbt)))} | ${Math.round(median(s.B.map(x => x.tbt)))} | ${wins('tbt')}/${pairs} | ${Math.round(median(s.A.map(x => x.lcp)))} | ${Math.round(median(s.B.map(x => x.lcp)))} | ${wins('lcp')}/${pairs} |`;
	lines.push(row);
	console.log(row);
}
await browser.close();
writeFileSync('ab-vitals.json', JSON.stringify(raw, null, '\t'));
writeFileSync('ab-vitals.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
