import { describe, expect, it } from 'vitest';
import { shareLevelLabel, shareLevelLabels } from '../share-helpers';

describe('shareLevelLabel', () => {
	it('maps viewer → Viewer and editor → Editor', () => {
		expect(shareLevelLabel('viewer')).toBe('Viewer');
		expect(shareLevelLabel('editor')).toBe('Editor');
	});

	it('the label map covers exactly the two ShareLevels', () => {
		expect(Object.keys(shareLevelLabels).sort()).toEqual(['editor', 'viewer']);
	});
});
