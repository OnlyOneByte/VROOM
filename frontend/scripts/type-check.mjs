#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_CAPTURED_CHILD_OUTPUT = 1024 * 1024;

const MIN_CHECKED_FILES = Number(process.env.VROOM_TYPE_CHECK_MIN_FILES?.trim() || 50);

const TS_DIAGNOSTIC_CODE = /\bTS\d{4,5}\b/;

const MACHINE_FAILURE_LINE = /^\d+ FAILURE\b/m;

const PATTERN_FIXTURES = [
	{
		name: 'TS_DIAGNOSTIC_CODE',
		pattern: TS_DIAGNOSTIC_CODE,
		matches: [
			"a.ts(1,1): error TS2304: Cannot find name 'x'.",
			"a.ts:1:1 - error TS6133: 'icon' is declared but its value is never read.",
			'a.ts:1:1 - error TS17019: Unexpected token. Did you mean `{">"}` or `&gt;`?',
			"a.ts:2:32 - error TS18048: 'maybe' is possibly 'undefined'."
		],
		rejects: [
			'TS123: too few digits to be a diagnostic code',
			'dyld[1]: Library not loaded: @rpath/libSystem.B.dylib',
			'node: bad option: --tsgo'
		]
	},
	{
		name: 'MACHINE_FAILURE_LINE',
		pattern: MACHINE_FAILURE_LINE,
		matches: [
			'1760000000000 FAILURE "Cannot read properties of undefined"',
			'1760000000000 FAILURE undefined'
		],
		rejects: [
			'1760000000000 COMPLETED 314 FILES 0 ERRORS 5 WARNINGS 3 FILES_WITH_PROBLEMS',
			'1760000000000 ERROR "src/a.ts" 1:1 "a type named FAILURE "x" was expected"'
		]
	}
];

const selfUrl = new URL(import.meta.url);

if (selfUrl.searchParams.get('vroom-role') === 'spawn-guard') {
	installSpawnGuard();
} else {
	await main();
}

function installSpawnGuard() {
	const reportPath = process.env.VROOM_TSGO_GUARD_REPORT;
	if (!reportPath) return;

	// svelte-check's CJS bundle reads child_process.spawn at call time, so the patch must land before it loads.
	const cjsRequire = createRequire(import.meta.url);
	const childProcess = cjsRequire('child_process');
	const realSpawn = childProcess.spawn;

	const observations = [];
	const flush = () => {
		try {
			writeFileSync(reportPath, JSON.stringify({ installed: true, observations }), 'utf8');
		} catch {
			// The parent treats an unwritable report as a missing report.
		}
	};

	childProcess.spawn = function vroomGuardedSpawn(command, args) {
		const child = realSpawn.apply(this, arguments);
		if (isCompilerSpawn(args)) {
			const observation = {
				command: String(command),
				args: args.map(String),
				closed: false,
				exitCode: null,
				signal: null,
				error: null,
				output: ''
			};
			observations.push(observation);
			const absorb = chunk => {
				if (observation.output.length >= MAX_CAPTURED_CHILD_OUTPUT) return;
				observation.output += typeof chunk === 'string' ? chunk : String(chunk);
			};
			child.stdout?.on('data', absorb);
			child.stderr?.on('data', absorb);
			child.on('error', err => {
				observation.error = err?.message ?? String(err);
				flush();
			});
			child.on('close', (code, signal) => {
				observation.closed = true;
				observation.exitCode = code;
				observation.signal = signal;
				flush();
			});
			flush();
		}
		return child;
	};

	flush();
}

function isCompilerSpawn(args) {
	return (
		Array.isArray(args) &&
		args.some(arg => typeof arg === 'string' && /(?:^|[\\/])(?:tsc|tsgo)(?:\.js|\.exe)?$/.test(arg))
	);
}

async function main() {
	assertPatterns();

	const selfPath = fileURLToPath(selfUrl);
	const frontendDir = path.resolve(path.dirname(selfPath), '..');
	const require = createRequire(pathToFileURL(path.join(frontendDir, 'package.json')));
	const forwarded = process.argv.slice(2);

	const kitBin = resolveBin(require, '@sveltejs/kit', 'svelte-kit');
	const sync = await runNode([kitBin, 'sync'], { cwd: frontendDir, inherit: true });
	if (sync.code !== 0 || sync.signal) {
		fail(
			`\`svelte-kit sync\` failed (exit ${sync.code}${sync.signal ? `, signal ${sync.signal}` : ''}).`
		);
	}

	const tsgo = resolveTsgo(require);
	const version = await runNode([tsgo.binPath, '--version'], { cwd: frontendDir });
	if (version.code !== 0 || !/\d+\.\d+\.\d+/.test(version.output)) {
		fail(
			`the TypeScript compiler \`--tsgo\` delegates to is not runnable (exit ${version.code}).\n` +
				`  binary: ${tsgo.binPath}\n` +
				`  output: ${version.output.trim() || '(none)'}\n` +
				"  svelte-check ignores this child's exit code, so without this preflight the type-check\n" +
				'  would report "0 ERRORS" without checking anything.'
		);
	}

	// svelte-check --tsgo never prunes its shadow .ts files, so stale ones would keep reporting errors.
	rmSync(path.join(frontendDir, '.svelte-kit', '.svelte-check'), { recursive: true, force: true });

	const reportDir = mkdtempSync(path.join(tmpdir(), 'vroom-type-check-'));
	const reportPath = path.join(reportDir, 'tsgo-guard.json');
	const guardUrl = pathToFileURL(selfPath);
	guardUrl.searchParams.set('vroom-role', 'spawn-guard');

	const svelteCheckBin = require.resolve('svelte-check/bin/svelte-check');
	const checkArgs = [svelteCheckBin, '--tsconfig', './tsconfig.json', '--tsgo'];
	if (!forwarded.some(arg => arg === '--output' || arg.startsWith('--output='))) {
		if (process.env.CI || !process.stdout.isTTY) checkArgs.push('--output', 'machine');
	}
	checkArgs.push(...forwarded);

	let run;
	let report;
	try {
		run = await runNode(checkArgs, {
			cwd: frontendDir,
			nodeArgs: ['--import', guardUrl.href],
			tee: true,
			env: {
				VROOM_TSGO_GUARD_REPORT: reportPath,
				...(process.stdout.isTTY && !process.env.FORCE_COLOR ? { FORCE_COLOR: '1' } : {})
			}
		});
	} finally {
		report = readReport(reportPath);
		rmSync(reportDir, { recursive: true, force: true });
	}

	const output = stripAnsi(run.output);

	if (run.signal) fail(`svelte-check was killed by signal ${run.signal}.`);

	if (/svelte-check failed/.test(output) || MACHINE_FAILURE_LINE.test(output)) {
		fail(
			'svelte-check crashed. It reports internal errors without setting an exit code, so this\n' +
				'  would otherwise have passed as a clean type-check.'
		);
	}

	const completion =
		/COMPLETED (\d+) FILES (\d+) ERRORS/.exec(output) ??
		/svelte-check found (\d+) errors? and (\d+) warnings?/.exec(output);
	if (!completion) {
		fail(
			'svelte-check produced no completion summary, so the run did not finish normally\n' +
				'  (it exits 0 on internal errors, so its exit code cannot be trusted here).'
		);
	}

	if (!report) {
		fail(
			'the tsgo spawn guard did not report back, so the compiler child could not be verified.\n' +
				`  expected report: ${reportPath}`
		);
	}
	if (report.observations.length === 0) {
		fail(
			'svelte-check never spawned a TypeScript compiler, so nothing was type-checked\n' +
				'  (expected a `--tsgo` child process). If svelte-check changed how it checks types,\n' +
				'  update frontend/scripts/type-check.mjs.'
		);
	}
	for (const observation of report.observations) {
		const where = `${observation.command} ${observation.args.join(' ')}`;
		if (observation.error) {
			fail(`the TypeScript compiler child could not be started: ${observation.error}\n  ${where}`);
		}
		if (!observation.closed || observation.signal) {
			fail(
				`the TypeScript compiler child did not exit cleanly (signal ${observation.signal ?? 'none'}).\n  ${where}`
			);
		}
		if (observation.exitCode !== 0 && !TS_DIAGNOSTIC_CODE.test(stripAnsi(observation.output))) {
			fail(
				`the TypeScript compiler child failed (exit ${observation.exitCode}) without reporting any\n` +
					'  diagnostics, so "0 ERRORS" above means "never checked". svelte-check ignores this\n' +
					"  child's exit code and discards its stderr; it said:\n" +
					indent(stripAnsi(observation.output).trim() || '(no output)')
			);
		}
	}

	if (completion[0].startsWith('COMPLETED')) {
		const fileCount = Number(completion[1]);
		if (!(fileCount >= MIN_CHECKED_FILES)) {
			fail(
				`svelte-check only checked ${fileCount} files (expected at least ${MIN_CHECKED_FILES}).\n` +
					'  The project scope collapsed, so a pass here would be vacuous. Check tsconfig.json\n' +
					'  include/exclude, or lower VROOM_TYPE_CHECK_MIN_FILES deliberately.'
			);
		}
	}

	process.exit(run.code ?? 1);
}

function assertPatterns() {
	const broken = [];
	for (const { name, pattern, matches, rejects } of PATTERN_FIXTURES) {
		for (const sample of matches) {
			if (!pattern.test(sample)) broken.push(`${name} ${pattern} must match:     ${sample}`);
		}
		for (const sample of rejects) {
			if (pattern.test(sample)) broken.push(`${name} ${pattern} must not match: ${sample}`);
		}
	}
	if (broken.length > 0) {
		fail(
			"this wrapper's own output patterns no longer classify the tools' output correctly, so\n" +
				'  its verdicts cannot be trusted:\n' +
				indent(broken.join('\n'))
		);
	}
}

function fail(message) {
	console.error(`\ntype-check: ${message}\n`);
	process.exit(2);
}

function indent(text) {
	return text
		.split('\n')
		.map(line => `    ${line}`)
		.join('\n');
}

function resolveBin(require, packageName, binName) {
	let pkgJsonPath;
	try {
		pkgJsonPath = require.resolve(`${packageName}/package.json`);
	} catch {
		fail(`cannot resolve ${packageName}. Run \`npm ci\` in frontend/.`);
	}
	const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
	const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
	if (!relative) fail(`${packageName} declares no "${binName}" bin.`);
	const binPath = path.join(path.dirname(pkgJsonPath), relative);
	if (!existsSync(binPath) || !statSync(binPath).isFile()) {
		fail(`${packageName}'s ${binName} bin is missing at ${binPath}. Run \`npm ci\` in frontend/.`);
	}
	return binPath;
}

function resolveTsgo(require) {
	// Must mirror svelte-check's own --tsgo resolution order.
	for (const packageName of ['@typescript/native', '@typescript/native-preview']) {
		let pkgJsonPath;
		try {
			pkgJsonPath = require.resolve(`${packageName}/package.json`);
		} catch {
			continue;
		}
		const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
		const binName = pkg.name === '@typescript/native-preview' ? 'tsgo' : 'tsc';
		const relative = pkg.bin?.[binName];
		if (!relative) continue;
		const binPath = path.join(path.dirname(pkgJsonPath), relative);
		if (!existsSync(binPath) || !statSync(binPath).isFile()) {
			fail(`${packageName} has no ${binName} bin at ${binPath}. Run \`npm ci\` in frontend/.`);
		}
		return { packageName, binPath };
	}
	fail(
		'cannot resolve the tsgo compiler package (@typescript/native or @typescript/native-preview)\n' +
			'  that `--tsgo` requires. Run `npm ci` in frontend/.'
	);
}

function runNode(args, { cwd, nodeArgs = [], env = {}, inherit = false, tee = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [...nodeArgs, ...args], {
			cwd,
			env: { ...process.env, ...env },
			stdio: inherit ? 'inherit' : ['inherit', 'pipe', 'pipe']
		});
		let output = '';
		if (!inherit) {
			child.stdout.on('data', chunk => {
				output += chunk;
				if (tee) process.stdout.write(chunk);
			});
			child.stderr.on('data', chunk => {
				output += chunk;
				if (tee) process.stderr.write(chunk);
			});
		}
		child.on('error', reject);
		child.on('close', (code, signal) => resolve({ code, signal, output }));
	});
}

function readReport(reportPath) {
	try {
		const report = JSON.parse(readFileSync(reportPath, 'utf8'));
		return Array.isArray(report?.observations) ? report : null;
	} catch {
		return null;
	}
}

function stripAnsi(text) {
	// eslint-disable-next-line no-control-regex
	return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}
