import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMPONENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'CategorySelector.svelte');

const LABEL = /label:\s*(['"])(.*?)\1/g;

function extractLabels(source: string): string[] {
	const labels: string[] = [];
	for (const match of source.matchAll(LABEL)) {
		if (match[2] !== undefined) labels.push(match[2]);
	}
	return labels;
}

describe('CategorySelector labels stay single-word', () => {
	const source = readFileSync(COMPONENT, 'utf8');
	const labels = extractLabels(source);

	test('the scan finds the labels', () => {
		expect(labels.length).toBe(6);
	});

	test('no category label is multi-word (would wrap in the 2-col mobile grid)', () => {
		const offenders = labels.filter(label => /\s/.test(label.trim()));

		expect(
			offenders,
			`Multi-word CategorySelector label(s) found: ${JSON.stringify(offenders)}. ` +
				'A label with a space wraps to a second line in the grid-cols-2 mobile layout ' +
				'(floating the icon mid-card). Keep the label one word and put the ' +
				'detail in the description instead.'
		).toEqual([]);
	});
});
