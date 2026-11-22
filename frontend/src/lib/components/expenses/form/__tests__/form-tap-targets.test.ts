import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function source(rel: string): string {
	return readFileSync(join(COMPONENTS, rel), 'utf8');
}

describe('expense and vehicle form controls meet the 40px tap target on mobile', () => {
	test('the photo Upload and Add buttons are 40px below sm', () => {
		for (const file of [
			'expenses/form/ExpensePhotoSection.svelte',
			'expenses/form/PendingPhotoPreview.svelte'
		]) {
			expect(source(file)).toContain('class="h-10 text-xs sm:h-7"');
		}
	});

	test('the photo actions are visible without hover below sm and on keyboard focus from sm up', () => {
		const section = source('expenses/form/ExpensePhotoSection.svelte');
		expect(section).toContain(
			'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
		);
		expect(section).not.toMatch(/p-2 opacity-0/);
	});

	test('small icon buttons pad their hit area to 40px', () => {
		expect(source('expenses/form/TagInput.svelte')).toContain(
			"relative hover:text-primary after:absolute after:-inset-3.5 after:content-['']"
		);
		expect(source('expenses/form/PendingPhotoPreview.svelte')).toContain(
			"after:absolute after:-top-1 after:-right-1 after:-bottom-4 after:-left-4 after:content-['']"
		);
	});

	test('text and toggle buttons are at least 40px tall below sm', () => {
		expect(source('expenses/form/TagInput.svelte')).toContain(
			'class="flex w-full min-h-10 items-center text-left px-3 py-2 hover:bg-accent text-sm sm:min-h-0"'
		);
		expect(
			source('expenses/form/FuelFieldsSection.svelte').match(/class="h-10 flex-1 gap-1\.5 sm:h-8"/g)
		).toHaveLength(2);
		const scan = source('expenses/form/ReceiptScanButton.svelte');
		expect(scan).toContain('class="h-10 w-full sm:h-9"');
		expect(scan).toContain('inline-flex min-h-10 items-center self-start');
		expect(source('expenses/form/expense-form/SplitVehiclePicker.svelte')).toContain(
			'class="inline-flex min-h-10 items-center text-xs'
		);
	});

	test('the unit preferences toggle is 40px below sm and 36px from sm up', () => {
		expect(source('vehicles/form/VehicleForm.svelte')).toMatch(
			/<Collapsible\.Trigger\s+class="[^"]*\bsize-10 shrink-0 sm:size-9"/
		);
	});
});
