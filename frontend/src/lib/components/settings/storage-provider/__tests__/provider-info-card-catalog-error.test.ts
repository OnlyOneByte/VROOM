import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getCatalog = vi.fn();
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: () => getCatalog(),
		getSyncStatus: vi.fn(() => Promise.resolve({})),
		backfillProvider: vi.fn()
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: vi.fn() }
}));

const ProviderInfoCard = (await import('../ProviderInfoCard.svelte')).default;
const { STORAGE_CATALOG } = await import('#lib/stores/__tests__/provider-catalog-fixtures.ts');

const S3: UserProviderInfo = {
	id: 'prov-s3',
	domain: 'storage',
	providerType: 's3',
	displayName: 'My Bucket',
	status: 'active',
	config: {},
	createdAt: '2026-01-01T00:00:00.000Z'
};

describe('ProviderInfoCard when the provider catalog fails to load', () => {
	test('says so with a Retry that brings back the backup toggles', async () => {
		getCatalog.mockRejectedValueOnce(new Error('offline'));
		render(ProviderInfoCard, {
			props: {
				provider: S3,
				categorySettings: {
					vehicle_photos: { enabled: true, folderPath: 'v' },
					expense_receipts: { enabled: true, folderPath: 'r' },
					insurance_docs: { enabled: true, folderPath: 'i' },
					odometer_readings: { enabled: true, folderPath: 'o' }
				},
				onEdit: vi.fn(),
				onDelete: vi.fn()
			}
		});

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain("Couldn't load the backup options");
		expect(screen.queryByLabelText('ZIP backup')).toBeNull();

		getCatalog.mockResolvedValueOnce(STORAGE_CATALOG);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(await screen.findByLabelText('ZIP backup')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('S3 Compatible')).toBeInTheDocument();
	});
});
