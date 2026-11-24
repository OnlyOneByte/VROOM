import { describe, expect, test } from 'vitest';
import { columnWidth, COLUMN_WIDTH } from '../bar-columns.ts';

describe('columnWidth', () => {
	test('a band with room gets the 12 px column', () => {
		expect(columnWidth(40, false)).toBe(COLUMN_WIDTH);
		expect(columnWidth(12, false)).toBe(COLUMN_WIDTH);
	});

	test('a band narrower than 12 px keeps its own width, so columns never overlap', () => {
		expect(columnWidth(8, false)).toBeUndefined();
	});

	test('grouped bars keep their sub-band widths', () => {
		expect(columnWidth(80, true)).toBeUndefined();
	});

	test('before the scale exists there is no fixed width', () => {
		expect(columnWidth(undefined, false)).toBeUndefined();
	});
});
