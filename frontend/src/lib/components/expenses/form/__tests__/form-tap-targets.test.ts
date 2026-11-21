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

	test('the photo actions are visible without hover below sm', () => {
		const section = source('expenses/form/ExpensePhotoSection.svelte');
		expect(section).toContain('sm:opacity-0 sm:group-hover:opacity-100');
		expect(section).not.toMatch(/p-2 opacity-0/);
	});

	test('a tag remove button pads its 12px icon to a 40px hit area', () => {
		expect(source('expenses/form/TagInput.svelte')).toContain(
			"relative hover:text-primary after:absolute after:-inset-3.5 after:content-['']"
		);
	});

	test('the unit preferences toggle is 40px below sm and 36px from sm up', () => {
		expect(source('vehicles/form/VehicleForm.svelte')).toMatch(
			/<Collapsible\.Trigger\s+class="[^"]*\bsize-10 shrink-0 sm:size-9"/
		);
	});
});
