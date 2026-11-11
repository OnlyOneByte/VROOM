#!/usr/bin/env node
/**
 * Guarded `svelte-check` runner — the single entry point for every type-check consumer
 * (npm scripts, CI, the git hook, local/agent invocations).
 *
 * svelte-check is fail-open in two independent ways, so running it bare is a gate that
 * passes without having type-checked anything:
 *
 *   1. Its top-level wrapper ends with `catch (_err) { console.error(_err);
 *      console.error('svelte-check failed'); }` — no `process.exit`, so ANY internal throw
 *      leaves the exit code at 0.
 *   2. With `--tsgo`, checking is delegated to a spawned
 *      `node node_modules/@typescript/native/bin/tsc` child, and svelte-check does
 *      `proc.on('close', () => resolve(parseDiagnostics(output)))` — the child's exit code is
 *      IGNORED and its stderr is folded into the parse input and discarded. A missing platform
 *      binary (`@typescript/typescript-<platform>-<arch>`, e.g. on a new runner arch) therefore
 *      reports "COMPLETED N FILES 0 ERRORS", exits 0, and prints no failure marker at all.
 *
 * This wrapper turns both into hard failures, and only reports success when it has positive
 * evidence that checking actually happened:
 *
 *   - PREFLIGHT: resolve the same tsgo package + bin svelte-check will resolve, and run it
 *     (`--version`) so an unresolvable platform binary fails loudly, before the check.
 *   - SPAWN GUARD: re-enter this file via `node --import` inside the svelte-check process and
 *     patch `child_process.spawn`, so we observe the compiler child svelte-check hides —
 *     that it was spawned at all, its exit status, and its output. A non-zero child that
 *     emitted no TypeScript diagnostic code is an infrastructure failure, not a type error.
 *   - COMPLETION: require svelte-check's own completion line in the output (and reject its
 *     crash markers), so a mid-run throw cannot pass as a clean run.
 *   - FILE COUNT: when the machine output format reports a file count, require it to be
 *     plausible, so a scope collapse (tsconfig matching ~nothing) cannot pass vacuously.
 *   - PATTERNS: every verdict above hinges on matching the tools' text output, and a pattern
 *     that has quietly stopped matching looks exactly like a clean run, so the patterns are
 *     themselves asserted against sample lines (`PATTERN_FIXTURES`) before each run.
 *
 * Exit codes: 0 = clean, 1 = svelte-check reported problems, 2 = this wrapper's guards failed
 * (i.e. the result could not be trusted).
 *
 * KNOWN LIMITS (deliberately not overclaimed):
 *   - A compiler child that runs, exits 0, and checks less than it should (e.g. an overlay
 *     tsconfig whose scope silently shrank) is only caught by the file-count floor, which is
 *     available in the machine output format; interactive runs (TTY, human output) do not
 *     report a total file count, so the floor is not asserted there.
 *   - Correctness of svelte-check's in-process Svelte/CSS diagnostics is not independently
 *     verified; only the TypeScript delegation is.
 *   - The spawn guard depends on svelte-check delegating to a spawned compiler under `--tsgo`.
 *     If that internal changes, the guard fails CLOSED (loudly) rather than silently
 *     degrading — update this wrapper at that point.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Captured child output cap, so a pathological compiler run cannot exhaust memory. */
const MAX_CAPTURED_CHILD_OUTPUT = 1024 * 1024;

/**
 * Floor for "did it actually check the project?" when a file count is reported. A blank
 * override falls back to the default rather than to `Number('') === 0`, which would disable
 * the floor without saying so; `0` still disables it deliberately, and junk yields NaN, which
 * fails the comparison below and so fails closed.
 */
const MIN_CHECKED_FILES = Number(process.env.VROOM_TYPE_CHECK_MIN_FILES?.trim() || 50);

/**
 * A TypeScript diagnostic code as the compiler prints it (`error TS2304: …`). The bundled
 * TypeScript's error-category codes run 1002–18061: the four-digit 1xxx–9xxx families plus 69
 * five-digit ones in the 17xxx (JSX) and 18xxx (`possibly 'undefined'`, `of type 'unknown'`, …)
 * families, so a four-digit-only pattern misses real type errors entirely.
 */
const TS_DIAGNOSTIC_CODE = /\bTS\d{4,5}\b/;

/**
 * svelte-check's machine writer prefixes every line with an epoch timestamp and reports a
 * crash as `FAILURE <JSON message>`. Anchoring on that line shape covers a thrown non-Error,
 * whose `err.message` interpolates as a bare `undefined`, without mistaking a diagnostic whose
 * own message text happens to contain the word for a crash.
 */
const MACHINE_FAILURE_LINE = /^\d+ FAILURE\b/m;

/**
 * Fixtures for the two patterns above, asserted on every run. They are the only thing between
 * a swallowed compiler failure and a green type-check, and a pattern that has quietly stopped
 * matching the tools' real output looks exactly like a clean run.
 */
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

// ---------------------------------------------------------------------------
// Role: spawn guard (loaded with `node --import` INSIDE the svelte-check process)
// ---------------------------------------------------------------------------

function installSpawnGuard() {
	const reportPath = process.env.VROOM_TSGO_GUARD_REPORT;
	if (!reportPath) return;

	// svelte-check's dist bundle is CJS and does `require('child_process')` at load time,
	// then calls `.spawn` off that module object — so patching the property here, before the
	// bundle loads, is what it will use.
	const cjsRequire = createRequire(import.meta.url);
	const childProcess = cjsRequire('child_process');
	const realSpawn = childProcess.spawn;

	const observations = [];
	const flush = () => {
		try {
			writeFileSync(reportPath, JSON.stringify({ installed: true, observations }), 'utf8');
		} catch {
			// A report we cannot write is handled by the parent as a missing report.
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
			// Extra 'data' listeners do not steal chunks from svelte-check's own listeners.
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

	// Write immediately, so "guard never installed" is distinguishable from "no compiler spawn".
	flush();
}

/** Does this spawn look like svelte-check delegating to tsc/tsgo? */
function isCompilerSpawn(args) {
	return (
		Array.isArray(args) &&
		args.some(arg => typeof arg === 'string' && /(?:^|[\\/])(?:tsc|tsgo)(?:\.js|\.exe)?$/.test(arg))
	);
}

// ---------------------------------------------------------------------------
// Role: runner
// ---------------------------------------------------------------------------

async function main() {
	assertPatterns();

	const selfPath = fileURLToPath(selfUrl);
	const frontendDir = path.resolve(path.dirname(selfPath), '..');
	const require = createRequire(pathToFileURL(path.join(frontendDir, 'package.json')));
	const forwarded = process.argv.slice(2);

	// 1. Generated SvelteKit types must exist and be current, and a sync failure must not be
	//    swallowed (package.json's `prepare` tolerates failure for the npm install lifecycle).
	const kitBin = resolveBin(require, '@sveltejs/kit', 'svelte-kit');
	const sync = await runNode([kitBin, 'sync'], { cwd: frontendDir, inherit: true });
	if (sync.code !== 0 || sync.signal) {
		fail(
			`\`svelte-kit sync\` failed (exit ${sync.code}${sync.signal ? `, signal ${sync.signal}` : ''}).`
		);
	}

	// 2. Preflight the exact compiler binary `--tsgo` will spawn. svelte-check discards this
	//    child's failures, so prove up front that it resolves and runs.
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

	// 3. Run svelte-check with the spawn guard attached.
	const reportDir = mkdtempSync(path.join(tmpdir(), 'vroom-type-check-'));
	const reportPath = path.join(reportDir, 'tsgo-guard.json');
	const guardUrl = pathToFileURL(selfPath);
	guardUrl.searchParams.set('vroom-role', 'spawn-guard');

	const svelteCheckBin = require.resolve('svelte-check/bin/svelte-check');
	const checkArgs = [svelteCheckBin, '--tsconfig', './tsconfig.json', '--tsgo'];
	// The machine format is the only one that reports a total file count, so prefer it whenever
	// nobody is reading the prettier human output interactively.
	if (!forwarded.some(arg => arg === '--output' || arg.startsWith('--output='))) {
		if (process.env.CI || !process.stdout.isTTY) checkArgs.push('--output', 'machine');
	}
	checkArgs.push(...forwarded);

	let run;
	// Assigned in the finally below, which always runs.
	let report;
	try {
		run = await runNode(checkArgs, {
			cwd: frontendDir,
			nodeArgs: ['--import', guardUrl.href],
			tee: true,
			env: {
				VROOM_TSGO_GUARD_REPORT: reportPath,
				// Keep colors alive across our pipe when a human is watching.
				...(process.stdout.isTTY && !process.env.FORCE_COLOR ? { FORCE_COLOR: '1' } : {})
			}
		});
	} finally {
		report = readReport(reportPath);
		rmSync(reportDir, { recursive: true, force: true });
	}

	// 4. Verify the run actually type-checked, instead of trusting the exit code.
	const output = stripAnsi(run.output);

	if (run.signal) fail(`svelte-check was killed by signal ${run.signal}.`);

	// `svelte-check failed` comes from its own top-level catch, which does not go through a
	// writer, so that marker is not line-anchored. The human writer prints a crash as the bare
	// error text with no marker at all; that path is covered by the completion check below.
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
		// A non-zero compiler exit is normal when it found type errors — those surface as
		// svelte-check diagnostics. A non-zero exit with no diagnostic code at all is the
		// silent failure svelte-check swallows.
		if (observation.exitCode !== 0 && !TS_DIAGNOSTIC_CODE.test(stripAnsi(observation.output))) {
			fail(
				`the TypeScript compiler child failed (exit ${observation.exitCode}) without reporting any\n` +
					'  diagnostics, so "0 ERRORS" above means "never checked". svelte-check ignores this\n' +
					"  child's exit code and discards its stderr; it said:\n" +
					indent(stripAnsi(observation.output).trim() || '(no output)')
			);
		}
	}

	// Only the machine format reports a total file count (see KNOWN LIMITS).
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

/** Verify this wrapper's output patterns still classify the tools' real output correctly. */
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

/** Resolve a package's bin the way svelte-check does: off its package.json, not the PATH shim. */
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

/** Mirror svelte-check's `--tsgo` binary resolution (@typescript/native, else -preview). */
function resolveTsgo(require) {
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

/** Run `node <args>`; returns { code, signal, output }. Streams while capturing when tee'ing. */
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
