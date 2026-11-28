import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');
const ROW = readFileSync(
	join(HERE, '..', '..', '..', 'lib', 'components', 'reminders', 'ReminderRow.svelte'),
	'utf8'
);

describe('reminder row mobile layout (occlusion guard)', () => {
	test('the text column shrinks and truncates instead of being pushed under the actions', () => {
		expect(ROW).toMatch(/class="min-w-0 flex-1"/);
		expect(ROW).toMatch(/class="truncate font-semibold"/);
	});

	test('the sections column can shrink below a long row', () => {
		expect(PAGE).toMatch(/class="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2"/);
	});

	test('the status column and the menu button never shrink', () => {
		expect(ROW).toMatch(/class="flex shrink-0 flex-col items-end"/);
		expect(ROW).toMatch(/aria-label="More actions for \{reminder\.name\}"/);
	});

	test('Edit, Pause and Delete live in the menu, not as inline buttons', () => {
		const menu = ROW.slice(ROW.indexOf('<Popover.Content'));
		expect(menu).toContain('Edit');
		expect(menu).toContain('Pause');
		expect(menu).toContain('Delete');
	});
});
