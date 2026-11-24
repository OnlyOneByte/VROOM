import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results/e2e-results.json';
if (!existsSync(file)) {
	console.log(`e2e-retry-report: no ${file}, nothing to report.`);
	process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const flaky = [];
const colour = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function walk(suite, titles) {
	const path = suite.title ? [...titles, suite.title] : titles;
	for (const spec of suite.specs ?? []) {
		for (const test of spec.tests ?? []) {
			if (test.status !== 'flaky') continue;
			const failures = (test.results ?? []).filter(
				r => r.status !== 'passed' && r.status !== 'skipped'
			);
			flaky.push({
				title: [...path.slice(1), spec.title].join(' › '),
				file: spec.file,
				line: spec.line,
				attempts: (test.results ?? []).length,
				error: (failures[0]?.error?.message ?? '').replace(colour, '').split('\n')[0]
			});
		}
	}
	for (const child of suite.suites ?? []) walk(child, path);
}

for (const suite of report.suites ?? []) walk(suite, []);

const lines = [];
if (flaky.length === 0) {
	lines.push('### Passed only on retry', '', 'None.');
} else {
	lines.push(
		'### Passed only on retry',
		'',
		`${flaky.length} ${flaky.length === 1 ? 'test' : 'tests'} failed and then passed on a retry. Each one is a flake: fix it or quarantine it today (docs/conventions/Flaky-Tests.md).`,
		'',
		'| Test | File | Attempts | First failure |',
		'|---|---|---|---|'
	);
	const cell = text => text.replaceAll('|', '\\|');
	const command = text =>
		text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
	for (const t of flaky) {
		const error = cell(t.error).slice(0, 160);
		lines.push(`| ${cell(t.title)} | \`${t.file}:${t.line}\` | ${t.attempts} | ${error} |`);
		console.log(
			`::warning file=frontend/e2e/${t.file},line=${t.line}::${command(`Passed only on retry: ${t.title}`)}`
		);
	}
}

const summary = lines.join('\n') + '\n';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
