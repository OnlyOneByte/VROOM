import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ANIMATED = [
	'dialog/dialog-content.svelte',
	'dialog/dialog-overlay.svelte',
	'alert-dialog/alert-dialog-content.svelte',
	'alert-dialog/alert-dialog-overlay.svelte',
	'sheet/sheet-content.svelte',
	'sheet/sheet-overlay.svelte'
];

describe('dialogs and sheets respect reduced motion', () => {
	test.each(ANIMATED)('%s turns its enter and exit animation off with an important rule', file => {
		const source = readFileSync(join(UI, file), 'utf8');
		expect(source).toMatch(/data-\[state=open\]:animate-in/);
		expect(source).toContain('motion-reduce:animate-none!');
	});

	test('the sheet stops its slide transition too', () => {
		expect(readFileSync(join(UI, 'sheet/sheet-content.svelte'), 'utf8')).toContain(
			'motion-reduce:transition-none!'
		);
	});
});
