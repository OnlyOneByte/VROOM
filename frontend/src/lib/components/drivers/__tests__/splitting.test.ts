import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { SplitRules } from '#lib/types/index.ts';

const rules = vi.fn<() => Promise<SplitRules>>();
const setRules = vi.fn<(id: string, next: SplitRules) => Promise<SplitRules>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: {
		rules: () => rules(),
		setRules: (id: string, next: SplitRules) => setRules(id, next)
	}
}));

import SplittingSection from '../SplittingSection.svelte';

const drivers = [
	{ id: 'a', userId: 'u1', name: 'Alex', color: null, archived: false },
	{ id: 's', userId: null, name: 'Sam', color: null, archived: false }
];

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('splitting', () => {
	test('shows the saved rules, with each fixed share', async () => {
		const fixed: SplitRules = {
			running: { kind: 'distance' },
			ownership: { kind: 'fixed', shares: { a: 70, s: 30 } }
		};
		rules.mockResolvedValue(fixed);
		setRules.mockImplementation(async (_id, next) => next);
		render(SplittingSection, { props: { vehicleId: 'car', drivers } });
		await settle();
		expect(screen.getByText('By distance driven')).toBeTruthy();
		expect(screen.getByText('Alex 70% · Sam 30%')).toBeTruthy();
	});

	test('says so when the rules cannot load, with a retry', async () => {
		rules.mockRejectedValueOnce(new Error('offline'));
		rules.mockResolvedValue({ running: { kind: 'equal' }, ownership: { kind: 'payer' } });
		render(SplittingSection, { props: { vehicleId: 'car', drivers } });
		await settle();
		expect(screen.getByRole('alert').textContent).toContain("Couldn't load the splitting");
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(screen.getByText('Equally')).toBeTruthy();
	});
});
