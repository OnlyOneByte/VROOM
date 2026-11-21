import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function source(rel: string): string {
	return readFileSync(join(COMPONENTS, rel), 'utf8');
}

describe('form controls meet the 40px tap target on mobile', () => {
	test('Input is 40px below sm and 36px from sm up', () => {
		const input = source('ui/input/input.svelte');
		expect(input.match(/\bh-10 w-full sm:h-9\b/g)).toHaveLength(2);
		expect(input).not.toMatch(/flex h-9 w-full/);
	});

	test('Select trigger is 40px below sm and 36px from sm up', () => {
		const trigger = source('ui/select/select-trigger.svelte');
		expect(trigger).toContain('data-[size=default]:h-10 sm:data-[size=default]:h-9');
	});

	test('DatePicker trigger is 40px below sm and 36px from sm up', () => {
		expect(source('common/date-picker.svelte')).toContain(
			"'h-10 w-full justify-start text-left font-normal sm:h-9'"
		);
	});
});
