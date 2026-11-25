import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function source(rel: string): string {
	return readFileSync(join(COMPONENTS, rel), 'utf8');
}

describe('form fields are the 46px C3 field at every width', () => {
	test('Input is 46px tall and never shrinks from sm up', () => {
		const input = source('ui/input/input.svelte');
		expect(input.match(/\bh-11\.5 w-full\b/g)).toHaveLength(2);
		expect(input).not.toMatch(/\bsm:h-\d/);
	});

	test('Select trigger matches the 46px Input', () => {
		const trigger = source('ui/select/select-trigger.svelte');
		expect(trigger).toContain('data-[size=default]:h-11.5');
		expect(trigger).not.toMatch(/sm:data-\[size=default\]:h-/);
	});

	test.each(['common/date-picker.svelte', 'common/date-range-picker.svelte'])(
		'%s trigger matches the 46px Input and truncates a long date inside its field',
		file => {
			const picker = source(file);
			expect(picker).toMatch(/\bh-11\.5 w-full min-w-0 justify-start\b/);
			expect(picker).not.toMatch(/\bsm:h-\d/);
			expect(picker).toMatch(/<span[^>]*class=[^>]*min-w-0 truncate/);
		}
	);

	test('compact expense list sort buttons match the category select, 8px apart', () => {
		const list = source('expenses/expenses-table/ExpensesCompactList.svelte');
		expect(list.match(/class="h-10 px-2 text-xs sm:h-9"/g)).toHaveLength(2);
		expect(list).toContain('<div class="ml-auto flex items-center gap-2">');
	});

	test('the compact category filter carries no height that the select overrides', () => {
		const filter = source('expenses/expenses-table/ExpenseCategoryFilter.svelte');
		expect(filter).not.toMatch(/'h-8 px-2 border-none[^']*text-xs'/);
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
