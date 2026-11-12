import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'ChartCard.svelte'), 'utf8');

describe('ChartCard keeps its visibility-gate + four-state contract', () => {
	test('uses createVisibilityWatch as the render gate', () => {
		expect(SRC).toContain('createVisibilityWatch');
	});

	test('gates the chart children behind gate.visible', () => {
		expect(SRC).toMatch(/\{#if gate\.visible\}/);
		expect(SRC).toContain('@render children()');
	});

	test('the not-yet-visible (gated) state renders a Skeleton, never a blank box', () => {
		const gateIdx = SRC.indexOf('{#if gate.visible}');
		expect(gateIdx).toBeGreaterThan(-1);
		const afterGate = SRC.slice(gateIdx);
		expect(afterGate).toMatch(/\{:else\}/);
		expect(afterGate).toContain('Skeleton');
	});

	test('renders the full four-state set (loading / error / empty / data)', () => {
		expect(SRC).toContain('isLoading');
		expect(SRC).toMatch(/:else if error/);
		expect(SRC).toMatch(/:else if isEmpty/);
		expect(SRC).toContain('EmptyState');
	});
});
