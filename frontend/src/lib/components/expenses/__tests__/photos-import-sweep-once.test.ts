import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { ReceiptDraftItem } from '#lib/services/photos-import-api.ts';
import type { Vehicle } from '#lib/types/index.ts';

const CALL_BUDGET = 8;

let drafts: ReceiptDraftItem[] = [];
const getReceiptDrafts = vi.fn(async () => {
	if (getReceiptDrafts.mock.calls.length > CALL_BUDGET) {
		throw new Error(`sweep called more than ${CALL_BUDGET} times — unbounded sweep loop`);
	}
	return drafts;
});
const confirmDraft = vi.fn(async () => ({}));
vi.mock('#lib/services/photos-import-api.ts', () => ({
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
