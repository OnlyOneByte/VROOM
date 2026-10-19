/**
 * "Import from Photos" must sweep the album ONCE per time the dialog is opened.
 *
 * The sweep is expensive on the server (one Google Photos album search plus a
 * per-photo already-imported lookup) and the steady state — everything already imported, or an
 * empty album — returns ZERO drafts. An open-gate that infers "we have not swept yet" from the
 * RESULT (no rows, not loading, no error) can never recognise that state as swept, so an empty
 * album re-arms the gate on every sweep and the dialog hammers the endpoint for as long as it
 * stays open. The gate must therefore key on the OPEN TRANSITION, not on the result.
 *
 * The mocked endpoint below fails the test by its own call budget, so a regression shows up as a
 * bounded failure instead of a hung test run.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { ReceiptDraftItem } from '$lib/services/photos-import-api';
import type { Vehicle } from '$lib/types';

vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));

/** Hard budget: past this the dialog is looping, and the rejection breaks the loop. */
const CALL_BUDGET = 8;

let drafts: ReceiptDraftItem[] = [];
const getReceiptDrafts = vi.fn(async () => {
	if (getReceiptDrafts.mock.calls.length > CALL_BUDGET) {
		throw new Error(`sweep called more than ${CALL_BUDGET} times — unbounded sweep loop`);
	}
	return drafts;
});
const confirmDraft = vi.fn(async () => ({}));
vi.mock('$lib/services/photos-import-api', () => ({
	photosImportApi: { getReceiptDrafts, confirmDraft }
}));

const ImportFromPhotosDialog = (await import('../ImportFromPhotosDialog.svelte')).default;

const VEHICLE: Vehicle = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
};

function draftItem(photoId: string): ReceiptDraftItem {
	return {
		photoId,
		draft: { amount: 42, category: 'maintenance', date: '2026-01-05' },
		thumbnailUrl: null
	};
}

/** Let every queued effect + the sweep's promise settle, repeatedly (a loop would keep re-arming). */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function mount(open = true) {
	return render(ImportFromPhotosDialog, {
		props: { open, vehicles: [VEHICLE], onImported: () => {} }
	});
}

beforeEach(() => {
	getReceiptDrafts.mockClear();
	drafts = [];
	localStorage.setItem('vroom.photos.import-disclosed', '1');
});

describe('ImportFromPhotosDialog open-gate', () => {
	test('an album with no new receipts is swept exactly once', async () => {
		const { container } = mount();
		await settle();

		expect(getReceiptDrafts).toHaveBeenCalledTimes(1);
		// And the user is told so, rather than being left on the loading skeleton.
		expect(
			container.ownerDocument.querySelector('[data-testid="photos-import-empty"]')
		).not.toBeNull();
	});

	test('an album with drafts is also swept exactly once', async () => {
		drafts = [draftItem('p1'), draftItem('p2')];
		mount();
		await settle();

		expect(getReceiptDrafts).toHaveBeenCalledTimes(1);
		expect(document.querySelectorAll('[data-testid="photos-import-row"]').length).toBe(2);
	});

	test('closing and reopening sweeps again', async () => {
		const { rerender } = mount();
		await settle();
		expect(getReceiptDrafts).toHaveBeenCalledTimes(1);

		await rerender({ open: false });
		await settle();
		expect(getReceiptDrafts).toHaveBeenCalledTimes(1);

		await rerender({ open: true });
		await settle();
		expect(getReceiptDrafts).toHaveBeenCalledTimes(2);
	});

	test('the first-ever open waits for the disclosure and sweeps once on acknowledgement', async () => {
		localStorage.removeItem('vroom.photos.import-disclosed');
		mount();
		await settle();

		// Nothing is read from Photos until the user has seen what will be read.
		expect(getReceiptDrafts).not.toHaveBeenCalled();
		const acknowledge = [...document.querySelectorAll('button')].find(
			button => button.textContent?.trim() === 'Continue'
		);
		expect(acknowledge).toBeDefined();
		acknowledge?.click();
		await settle();

		expect(getReceiptDrafts).toHaveBeenCalledTimes(1);
	});
});
