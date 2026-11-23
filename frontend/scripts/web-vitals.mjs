import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const baseUrl = process.env.VITALS_BASE_URL ?? 'http://127.0.0.1:4173';
const session = process.env.VITALS_SESSION;
const vehicleId = process.env.VITALS_VEHICLE_ID;
const runs = Number(process.env.VITALS_RUNS ?? 3);
const cpuRate = 4;
const metrics = ['lcp', 'tbt', 'cls'];

if (!session || !vehicleId) {
	console.error(
		'web-vitals: set VITALS_SESSION and VITALS_VEHICLE_ID (printed by scripts/web-vitals-seed.mjs).'
	);
	process.exit(1);
}

const budgets = JSON.parse(readFileSync(join(root, 'web-vitals-budgets.json'), 'utf8'));
const routes = [
	['Dashboard', '/dashboard'],
	['Vehicle page', `/vehicles/${vehicleId}`],
	['Analytics', '/analytics'],
	['All Expenses', '/expenses'],
	['Add Expense', '/expenses/new'],
	['Add Odometer Reading', `/vehicles/${vehicleId}/odometer/new`]
];

function observe() {
	window.__vitals = { lcp: 0, cls: 0, longTasks: [] };
	new PerformanceObserver(list => {
		for (const entry of list.getEntries()) window.__vitals.lcp = entry.startTime;
	}).observe({ type: 'largest-contentful-paint', buffered: true });
	new PerformanceObserver(list => {
		for (const entry of list.getEntries())
			if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
	}).observe({ type: 'layout-shift', buffered: true });
	new PerformanceObserver(list => {
		for (const entry of list.getEntries())
			window.__vitals.longTasks.push([entry.startTime, entry.duration]);
	}).observe({ type: 'longtask', buffered: true });
}

function readVitals() {
	const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
	const tbt = window.__vitals.longTasks
		.filter(([start]) => start >= fcp)
		.reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
	return { lcp: window.__vitals.lcp, cls: window.__vitals.cls, tbt, path: location.pathname };
}

const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const host = new URL(baseUrl).hostname;

const browser = await chromium.launch({ executablePath: process.env.VITALS_CHROMIUM || undefined });
const results = [];
for (const [name, path] of routes) {
	const samples = [];
	for (let i = 0; i < runs; i++) {
		const context = await browser.newContext({
			viewport: { width: 375, height: 812 },
			deviceScaleFactor: 2,
			isMobile: true
		});
		await context.addCookies([{ name: 'auth_session', value: session, domain: host, path: '/' }]);
		await context.addInitScript(observe);
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
		await page.goto(baseUrl + path, { waitUntil: 'networkidle', timeout: 120000 });
		await page.waitForTimeout(1500);
		samples.push(await page.evaluate(readVitals));
		await context.close();
	}
	const landed = samples.find(sample => sample.path !== path);
	if (landed) {
		await browser.close();
		console.error(`web-vitals: ${path} ended on ${landed.path}. Is the session valid?`);
		process.exit(1);
	}
	const ceiling = budgets.ceilings[name] ?? {};
	const row = {
		name,
		lcp: Math.round(median(samples.map(sample => sample.lcp))),
		tbt: Math.round(median(samples.map(sample => sample.tbt))),
		cls: Number(median(samples.map(sample => sample.cls)).toFixed(3)),
		ceiling
	};
	row.aboveTarget = metrics.filter(metric => row[metric] > budgets.target[metric]);
	row.over = metrics.filter(metric => row[metric] > (ceiling[metric] ?? budgets.target[metric]));
	results.push(row);
	console.log(`${name}: LCP ${row.lcp} ms, TBT ${row.tbt} ms, CLS ${row.cls}`);
}
await browser.close();

const names = list => list.join(', ').toUpperCase();
function status(row) {
	if (row.over.length > 0) return `**OVER** ${names(row.over)}`;
	if (row.aboveTarget.length > 0) {
		return `above target: ${names(row.aboveTarget)} (ceiling until ${row.ceiling.until})`;
	}
	return 'meets target';
}
const limit = (row, metric) => row.ceiling[metric] ?? budgets.target[metric];
const { target } = budgets;
const meeting = results.filter(row => row.aboveTarget.length === 0).length;
const lines = [
	`Web vitals at 375×812, ${cpuRate}× CPU, median of ${runs} cold loads. Target LCP ≤ ${target.lcp} ms, TBT ≤ ${target.tbt} ms, CLS ≤ ${target.cls}: ${meeting} of ${results.length} routes meet it.`,
	'',
	'| Route | LCP (ms) | TBT (ms) | CLS | Limit (LCP / TBT / CLS) | Status |',
	'|---|---|---|---|---|---|',
	...results.map(
		row =>
			`| ${row.name} | ${row.lcp} | ${row.tbt} | ${row.cls} | ${limit(row, 'lcp')} / ${limit(row, 'tbt')} / ${limit(row, 'cls')} | ${status(row)} |`
	)
];
const table = lines.join('\n');
console.log(`\n${table}`);
const reportDir = join(root, 'test-results/web-vitals');
mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'web-vitals.md'), `${table}\n`);
writeFileSync(join(reportDir, 'web-vitals.json'), `${JSON.stringify(results, null, '\t')}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);

const over = results.filter(row => row.over.length > 0);
if (over.length > 0) {
	console.error(
		`\nweb-vitals: ${over.length} route(s) over their limit. Fix the regression, or raise the limit in web-vitals-budgets.json and say why in the PR.`
	);
	process.exit(1);
}
