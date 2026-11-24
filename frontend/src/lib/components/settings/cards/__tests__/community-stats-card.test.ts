import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { CommunityStatsUpdate } from '#lib/types/index.ts';
import CommunityStatsCard from '../CommunityStatsCard.svelte';

type Save = (updates: CommunityStatsUpdate) => Promise<void>;

function mount(props: { optIn?: boolean; region?: string | null; onSave?: Save } = {}) {
	const onSave = vi.fn<Save>(props.onSave ?? (() => Promise.resolve()));
	const result = render(CommunityStatsCard, {
		props: { optIn: props.optIn ?? false, region: props.region ?? null, onSave }
	});
	return { ...result, onSave };
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function trigger(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing trigger ${id}`);
	return el;
}

async function pickOption(id: string, name: string) {
	await fireEvent.click(trigger(id));
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name }));
	await settle();
}

function toggle(): HTMLElement {
	return screen.getByRole('switch', { name: 'Include my vehicles in community stats' });
}

afterEach(() => {
	cleanup();
});

describe('CommunityStatsCard', () => {
	test('shows the consent copy, off by default and with no region', () => {
		mount();
		expect(screen.getByText('Community comparisons')).toBeInTheDocument();
		expect(screen.getByText('Compare with other owners')).toBeInTheDocument();
		expect(
			screen.getByText(
				'Only totals for groups of 10 or more people are ever shown — never your own numbers.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Never used: VIN, plate, nickname, notes, photos, locations, exact dates or odometer readings.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText("Off by default. Changing it doesn't affect your own data.")
		).toBeInTheDocument();
		expect(toggle()).toHaveAttribute('aria-checked', 'false');
		expect(trigger('community-region-country')).toHaveTextContent('Not set');
		expect(document.getElementById('community-region-subdivision')).toBeNull();
	});

	test('turning it on saves the opt-in', async () => {
		const { onSave } = mount();
		await fireEvent.click(toggle());
		await settle();
		expect(onSave).toHaveBeenCalledWith({ communityStatsOptIn: true });
	});

	test('turning it off saves straight away with no confirmation', async () => {
		const { onSave } = mount({ optIn: true });
		expect(toggle()).toHaveAttribute('aria-checked', 'true');
		await fireEvent.click(toggle());
		await settle();
		expect(onSave).toHaveBeenCalledWith({ communityStatsOptIn: false });
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	test('the switch is disabled and shows progress while a save is in flight', async () => {
		let finish: () => void = () => {};
		mount({ onSave: () => new Promise<void>(resolve => (finish = resolve)) });
		await fireEvent.click(toggle());
		await settle();
		expect(toggle()).toHaveAttribute('aria-checked', 'true');
		expect(toggle()).toBeDisabled();
		expect(screen.getByTestId('community-saving')).toBeInTheDocument();
		finish();
		await settle();
		expect(screen.queryByTestId('community-saving')).toBeNull();
	});

	test('a region save shows progress beside the region and disables the pickers', async () => {
		let finish: () => void = () => {};
		mount({ onSave: () => new Promise<void>(resolve => (finish = resolve)) });
		await pickOption('community-region-country', 'Germany');
		expect(screen.getByTestId('community-region-saving')).toBeInTheDocument();
		expect(trigger('community-region-country')).toBeDisabled();
		expect(screen.queryByTestId('community-saving')).toBeNull();
		finish();
		await settle();
		expect(screen.queryByTestId('community-region-saving')).toBeNull();
	});

	test('a long country name is truncated inside its trigger', () => {
		mount({ region: 'GS' });
		const label = trigger('community-region-country').querySelector('span.truncate');
		expect(label).toHaveTextContent('South Georgia & South Sandwich Islands');
	});

	test('a failed save puts the switch back to the saved value', async () => {
		mount({ onSave: () => Promise.reject(new Error('boom')) });
		await fireEvent.click(toggle());
		await settle();
		expect(toggle()).toHaveAttribute('aria-checked', 'false');
		expect(toggle()).not.toBeDisabled();
	});

	test('picking a country saves it as the region', async () => {
		const { onSave } = mount();
		await pickOption('community-region-country', 'Germany');
		expect(onSave).toHaveBeenCalledWith({ communityRegion: 'DE' });
	});

	test('a country with states offers them, and picking one saves the subdivision', async () => {
		const { onSave } = mount({ region: 'US' });
		expect(trigger('community-region-country')).toHaveTextContent('United States');
		expect(trigger('community-region-subdivision')).toHaveTextContent('Not set');
		await pickOption('community-region-subdivision', 'California');
		expect(onSave).toHaveBeenCalledWith({ communityRegion: 'US-CA' });
	});

	test('a saved subdivision shows both its country and its name', () => {
		mount({ region: 'CA-ON' });
		expect(trigger('community-region-country')).toHaveTextContent('Canada');
		expect(trigger('community-region-subdivision')).toHaveTextContent('Ontario');
	});

	test('clearing the state keeps the country, and Not set clears the region', async () => {
		const { onSave } = mount({ region: 'US-CA' });
		await pickOption('community-region-subdivision', 'Not set');
		expect(onSave).toHaveBeenLastCalledWith({ communityRegion: 'US' });
		cleanup();
		const second = mount({ region: 'DE' });
		await pickOption('community-region-country', 'Not set');
		expect(second.onSave).toHaveBeenLastCalledWith({ communityRegion: null });
	});

	test('re-picking the saved region does not save again', async () => {
		const { onSave } = mount({ region: 'DE' });
		await pickOption('community-region-country', 'Germany');
		expect(onSave).not.toHaveBeenCalled();
	});
});
