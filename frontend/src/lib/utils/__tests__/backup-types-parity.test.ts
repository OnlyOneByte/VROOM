import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_TYPES = resolve(here, '../../../../../backend/src/types.ts');
const BACKEND_SYNC = resolve(here, '../../../../../backend/src/api/sync');
const FRONTEND_TYPES = resolve(here, '../../types/settings.ts');
const SHARED = [
	'ProviderBackupSettings',
	'BackupConfig',
	'BackupFileInfo',
	'ProviderBackupList'
] as const;

function interfaceBody(src: string, name: string): string {
	const head = src.match(new RegExp(`export interface ${name}\\s*\\{`));
	if (head?.index === undefined) throw new Error(`interface ${name} not found`);
	const open = head.index + head[0].length - 1;
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === '{') depth++;
		if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
	}
	throw new Error(`interface ${name} is not closed`);
}

function members(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of body) {
		if ('{(<['.includes(ch)) depth++;
		if ('})>]'.includes(ch)) depth--;
		if (ch === ';' && depth === 0) {
			parts.push(current);
			current = '';
		} else current += ch;
	}
	parts.push(current);
	return parts.map(part => part.replace(/\s+/g, ' ').trim()).filter(part => part !== '');
}

function fields(src: string, name: string): string[] {
	return members(interfaceBody(src, name))
		.map(member => {
			const match = member.match(/^(readonly )?(['"]?)([\w$-]+)\2(\?)?: (.+)$/);
			if (!match) throw new Error(`${name}: can't read "${member}"`);
			const [, readonly = '', , key, optional = '', type = ''] = match;
			return `${readonly}${key}${optional}: ${type.replace(/^\| /, '')}`;
		})
		.sort();
}

describe('backup types parity with the backend', () => {
	const backendSrc = readFileSync(BACKEND_TYPES, 'utf8');
	const frontendSrc = readFileSync(FRONTEND_TYPES, 'utf8');

	it.each(SHARED)('%s has the same fields, optionality and types on both sides', name => {
		const backend = fields(backendSrc, name);
		expect(backend.length).toBeGreaterThan(0);
		expect(fields(frontendSrc, name)).toEqual(backend);
	});

	it('RestoreProviderInfo matches the restore providers route exactly', () => {
		const backend = fields(
			readFileSync(`${BACKEND_SYNC}/routes.ts`, 'utf8'),
			'RestoreProviderInfo'
		);
		expect(backend.length).toBeGreaterThan(0);
		expect(fields(frontendSrc, 'RestoreProviderInfo')).toEqual(backend);
	});

	it.each([
		[
			'BackupOrchestratorResult',
			'backup-strategy.ts',
			'BackupOrchestratorResult',
			['outcome', 'results']
		],
		[
			'RestoreResult',
			'restore.ts',
			'RestoreResponse',
			['preview', 'merge', 'imported', 'kept', 'grants']
		]
	])(
		'%s matches the backend %s, except where the backend names a type (%s)',
		(frontendName, file, backendName, namedTypeFields) => {
			const byName = (members: string[]) =>
				new Map(members.map(member => [member.split(':')[0] ?? member, member]));
			const backend = byName(fields(readFileSync(`${BACKEND_SYNC}/${file}`, 'utf8'), backendName));
			const frontend = byName(fields(frontendSrc, frontendName));
			expect(backend.size).toBeGreaterThan(0);
			expect([...frontend.keys()]).toEqual([...backend.keys()]);
			for (const [name, member] of backend) {
				if (namedTypeFields.includes(name.replace('?', ''))) continue;
				expect(frontend.get(name), name).toBe(member);
			}
		}
	);

	it('BackupOrchestratorResult.results entries have the backend BackupStrategyResult fields', () => {
		const strategySrc = readFileSync(`${BACKEND_SYNC}/backup-strategy.ts`, 'utf8');
		const backend = fields(strategySrc, 'BackupStrategyResult').map(m => m.split(':')[0]);
		const results = fields(frontendSrc, 'BackupOrchestratorResult').find(m =>
			m.startsWith('results:')
		);
		const entry = results?.match(/Record< ?string, ?\{(.*)\} ?>$/)?.[1];
		if (!entry) throw new Error(`can't read results entry: ${results}`);
		const frontend = fields(`export interface Entry {${entry}}`, 'Entry').map(m => m.split(':')[0]);
		expect(frontend).toEqual(backend);
	});

	it('RestoreResult.grants has the backend RegrantReport and DroppedGrant fields', () => {
		const grantsSrc = readFileSync(`${BACKEND_SYNC}/restore-grants.ts`, 'utf8');
		const names = (src: string, name: string) => fields(src, name).map(m => m.split(':')[0]);
		const grants = fields(frontendSrc, 'RestoreResult').find(m => m.startsWith('grants?:'));
		const report = grants?.match(/^grants\?: \{(.*)\}$/)?.[1];
		if (!report) throw new Error(`can't read grants: ${grants}`);
		const frontend = `export interface Report {${report}}`;
		expect(names(frontend, 'Report')).toEqual(names(grantsSrc, 'RegrantReport'));
		const dropped = fields(frontend, 'Report').find(m => m.startsWith('dropped:'));
		const entry = dropped?.match(/Array< ?\{(.*)\} ?>$/)?.[1];
		if (!entry) throw new Error(`can't read dropped entry: ${dropped}`);
		expect(names(`export interface Entry {${entry}}`, 'Entry')).toEqual(
			names(grantsSrc, 'DroppedGrant')
		);
	});

	it('RestoreDroppedReason lists the backend DroppedGrantReason values', () => {
		const grantsSrc = readFileSync(`${BACKEND_SYNC}/restore-grants.ts`, 'utf8');
		const union = (src: string, name: string) => {
			const body = src.match(new RegExp(`export type ${name} =([^;]+);`))?.[1];
			if (!body) throw new Error(`${name} not found`);
			return [...body.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
		};
		const backend = union(grantsSrc, 'DroppedGrantReason');
		expect(backend.length).toBeGreaterThan(0);
		expect(union(frontendSrc, 'RestoreDroppedReason')).toEqual(backend);
	});

	it('BackupOrchestratorResult.outcome lists the backend BackupOutcome values', () => {
		const strategySrc = readFileSync(`${BACKEND_SYNC}/backup-strategy.ts`, 'utf8');
		const union = strategySrc.match(/export type BackupOutcome = ([^;]+);/)?.[1];
		if (!union) throw new Error('BackupOutcome not found');
		const literals = (text: string) => [...text.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
		const outcome = fields(frontendSrc, 'BackupOrchestratorResult').find(member =>
			member.startsWith('outcome:')
		);
		expect(outcome).toBeDefined();
		expect(literals(outcome as string)).toEqual(literals(union));
	});

	it('reads inline objects, wrapped unions and readonly or quoted keys, and refuses anything else', () => {
		const src = [
			'export interface Sample {',
			'\tschedule: { hour: number; minute: number };',
			'\tkind:',
			"\t\t| 'a'",
			"\t\t| 'b';",
			"\treadonly 'quoted-key'?: string;",
			'\tafter: boolean;',
			'}',
			'export interface Broken {',
			'\t[key: string]: unknown;',
			'}'
		].join('\n');
		expect(fields(src, 'Sample')).toEqual(
			[
				'schedule: { hour: number; minute: number }',
				"kind: 'a' | 'b'",
				'readonly quoted-key?: string',
				'after: boolean'
			].sort()
		);
		expect(() => fields(src, 'Broken')).toThrow(/can't read/);
		expect(() => fields(src, 'Missing')).toThrow(/not found/);
	});
});
