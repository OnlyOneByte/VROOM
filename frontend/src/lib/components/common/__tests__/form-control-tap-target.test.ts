import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';

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

const INPUT_TAG = /<Input\b[\s\S]*?\/>/g;
const BARE_HEIGHT = /(?:^|[\s"'{])h-\d+(?=[\s"'}])/;
const SM_HEIGHT = /\bsm:h-\d+/;

function callersOverridingInputHeight(): string[] {
	const offenders: string[] = [];
	for (const file of collectSvelteFiles(join(COMPONENTS, '..', '..'))) {
		if (file.includes('/components/ui/')) continue;
		for (const tag of readFileSync(file, 'utf8').match(INPUT_TAG) ?? []) {
			if (BARE_HEIGHT.test(tag) && !SM_HEIGHT.test(tag)) offenders.push(file);
		}
	}
	return offenders;
}

describe('Input callers keep the mobile tap target', () => {
	test('the scan recognises a bare height override', () => {
		expect(BARE_HEIGHT.test('<Input class="h-8 text-sm" />')).toBe(true);
		expect(SM_HEIGHT.test('<Input class="h-10 text-sm sm:h-8" />')).toBe(true);
		expect(BARE_HEIGHT.test('<Input class="pl-10 text-sm" />')).toBe(false);
	});

	test('no caller sets a height without its sm: counterpart', () => {
		expect(callersOverridingInputHeight()).toEqual([]);
	});
});
