import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_TYPES = resolve(here, '../../../../../backend/src/types.ts');
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
