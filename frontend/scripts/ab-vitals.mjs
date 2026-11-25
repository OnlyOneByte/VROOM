// Throwaway A/B/C: interleaved loads on three servers. env: VITALS_SESSION, VITALS_VEHICLE_ID, AB_PAIRS (default 5), AB_LATENCY (ms, default 0).
// A = main on 4173, B = modulePreload false on 4174, C = preload only for route navigation on 4175.
import { appendFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const pairs = Number(process.env.AB_PAIRS ?? 5);
const latency = Number(process.env.AB_LATENCY ?? 0);
const session = process.env.VITALS_SESSION;
const vid = process.env.VITALS_VEHICLE_ID;
const servers = Object.fromEntries(
	(process.env.AB_SERVERS ?? 'A:4173,B:4174,C:4175').split(',').map(s => [s.split(':')[0], Number(s.split(':')[1])])
);
const variants = Object.keys(servers);

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
async function open(port, path) {
	const context = await browser.newContext({
		viewport: { width: 375, height: 812 },
		deviceScaleFactor: 2,
		isMobile: true,
		serviceWorkers: 'block'
	});
	await context.addCookies([{ name: 'auth_session', value: session, domain: '127.0.0.1', path: '/' }]);
	await context.addInitScript(observe);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	if (latency) {
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			latency,
			downloadThroughput: (10 * 1024 * 1024) / 8,
			uploadThroughput: (5 * 1024 * 1024) / 8
		});
	}
	let pending = 0;
	let last = 0;
	page.on('request', () => pending++);
	const done = () => {
		pending--;
		last = Date.now();
	};
	page.on('requestfinished', done);
	page.on('requestfailed', done);
	await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'networkidle', timeout: 180000 });
	await page.waitForTimeout(1000);
	const quiet = async () => {
		for (;;) {
			await page.waitForTimeout(100);
			if (pending <= 0 && Date.now() - last > 500) return;
		}
	};
	return { context, page, quiet, lastEnd: () => last };
}

async function cold(port, path) {
	const { context, page } = await open(port, path);
	const v = await page.evaluate(() => {
		const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
		const tbt = window.__v.lt.reduce((s, [st, d]) => s + Math.max(0, st + d - Math.max(st + 50, fcp)), 0);
		return { lcp: window.__v.lcp, tbt, path: location.pathname };
	});
	await context.close();
	if (v.path !== path) throw new Error(`${path} on ${port} ended on ${v.path}`);
	return { lcp: v.lcp, tbt: v.tbt };
}

async function navigate(port, from, to) {
	const { context, page, quiet, lastEnd } = await open(port, from);
	const start = Date.now();
	await page.evaluate(href => {
		const a = Object.assign(document.createElement('a'), { href });
		document.body.append(a);
		a.click();
	}, to);
	await page.waitForURL(`**${to}`);
	await quiet();
	const ms = lastEnd() - start;
	await context.close();
	return { ms };
}

async function openTab(port, path, tab) {
	const { context, page, quiet, lastEnd } = await open(port, path);
	const start = Date.now();
	await page.getByRole('tab', { name: tab, exact: true }).click();
	await quiet();
	const ms = lastEnd() - start;
	await context.close();
	return { ms };
}

const cases = [
	['Cold: Vehicle page', p => cold(p, `/vehicles/${vid}`), ['tbt', 'lcp']],
	['Cold: Analytics', p => cold(p, '/analytics'), ['tbt', 'lcp']],
	['Cold: Add Odometer Reading', p => cold(p, `/vehicles/${vid}/odometer/new`), ['tbt', 'lcp']],
	['Navigate: Dashboard → Vehicle page', p => navigate(p, '/dashboard', `/vehicles/${vid}`), ['ms']],
	['Navigate: Dashboard → Analytics', p => navigate(p, '/dashboard', '/analytics'), ['ms']],
	['Navigate: Dashboard → All Expenses', p => navigate(p, '/dashboard', '/expenses'), ['ms']],
	['Open tab: Vehicle → Odometer', p => openTab(p, `/vehicles/${vid}`, 'Odometer'), ['ms']],
	['Open tab: Analytics → Fuel & Stats', p => openTab(p, '/analytics', 'Fuel & Stats'), ['ms']]
];

const median = a => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)];
const lines = [
	`${variants.join('/')}, ${pairs} interleaved rounds per case, 375×812, 4× CPU, ${latency} ms added latency, service worker blocked. ${process.env.AB_LABEL ?? ''} Medians in ms; navigation and tab times run from the click to the last network response.`,
	'',
	`| Case | Metric | ${variants.join(' | ')} |`,
	`|---|---|${variants.map(() => '---').join('|')}|`
];
const raw = {};
for (const [name, run, metrics] of cases) {
	const s = Object.fromEntries(variants.map(v => [v, []]));
	for (let i = 0; i < pairs; i++) {
		const order = variants.map((_, k) => variants[(k + i) % variants.length]);
		for (const v of order) s[v].push(await run(servers[v]));
	}
	raw[name] = s;
	for (const m of metrics) {
		const row = `| ${name} | ${m.toUpperCase()} | ${variants.map(v => Math.round(median(s[v].map(x => x[m])))).join(' | ')} |`;
		lines.push(row);
		console.log(row);
	}
}
await browser.close();
writeFileSync('ab-vitals.json', JSON.stringify(raw, null, '\t'));
writeFileSync('ab-vitals.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
