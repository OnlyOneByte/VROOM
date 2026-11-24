import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { can, type PackedRules } from '#lib/utils/permissions.ts';

const CASES = JSON.parse(
	readFileSync(
		resolve(
			dirname(fileURLToPath(import.meta.url)),
			'../../../../../backend/src/permissions/__tests__/resolution.cases.json'
		),
		'utf8'
	)
) as {
	name: string;
	permission: string;
	entry?: 'own' | 'other';
	decision: { allow: boolean };
	packed: PackedRules;
}[];

describe('resolution.cases.json against the packed rules', () => {
	test('the shared table is not empty', () => {
		expect(CASES.length).toBeGreaterThan(20);
	});

	test.each(CASES)('$name', ({ permission, entry, decision, packed }) => {
		expect(can(packed, permission, entry)).toBe(decision.allow);
	});
});
