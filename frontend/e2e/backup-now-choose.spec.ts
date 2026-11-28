import { test, expect, type Page } from '@playwright/test';
import { E2E_USER, addSessionCookie, fulfillData, mockApi } from './support/mock-api';

const FOLDERS = {
	vehicle_photos: 'Vehicle',
	expense_receipts: 'Receipts',
	insurance_docs: 'Insurance',
	odometer_readings: 'Odometer'
};

function storageEntry(id: string, label: string, photoOnly: boolean) {
	return {
		id,
		label,
		shortLabel: label,
		description: label,
		scope: 'user',
		connect: 'form',
		fields: [],
		secrets: [],
		capability: 'storage',
		features: {
			photoOnly,
			backupSheets: false,
			defaultFolders: FOLDERS,
			defaultPhotoRootPath: 'Photos'
		}
	};
}

function provider(id: string, providerType: string, displayName: string) {
	return {
		id,
		domain: 'storage',
		providerType,
		displayName,
		status: 'active',
		config: {},
		createdAt: '2026-01-01T00:00:00.000Z'
	};
}

const BACKUP_CONFIG = {
	providers: {
		drive: { enabled: true, folderPath: 'Backups', retentionCount: 10 },
		s3: { enabled: false, folderPath: 'Backups', retentionCount: 10 }
	}
};

async function mockStorage(page: Page) {
	const settingsWrites: unknown[] = [];
	const syncBodies: Record<string, unknown>[] = [];
	await page.route(
		url => url.pathname === '/api/v1/providers/catalog',
		route =>
			fulfillData(route, [
				storageEntry('google-drive', 'Google Drive', false),
				storageEntry('s3', 'S3 bucket', false),
				storageEntry('google-photos', 'Google Photos', true)
			])
	);
	await page.route(
		url => url.pathname === '/api/v1/providers',
		route =>
			fulfillData(route, [
				provider('drive', 'google-drive', 'Family Drive'),
				provider('s3', 's3', 'Office S3'),
				provider('photos', 'google-photos', 'Holiday Photos')
			])
	);
	await page.route(
		url => url.pathname === '/api/v1/settings',
		route => {
			if (route.request().method() !== 'GET') {
				settingsWrites.push(route.request().postDataJSON());
				return route.fallback();
			}
			return fulfillData(route, {
				id: 'settings-1',
				userId: E2E_USER.id,
				currencyUnit: 'USD',
				backupConfig: BACKUP_CONFIG,
				syncInactivityMinutes: 5,
				syncOnInactivity: true,
				createdAt: '2024-01-01T12:00:00.000Z',
				updatedAt: '2024-01-01T12:00:00.000Z'
			});
		}
	);
	await page.route(
		url => url.pathname === '/api/v1/sync',
		route => {
			syncBodies.push(route.request().postDataJSON() as Record<string, unknown>);
			return fulfillData(route, {
				timestamp: '2026-11-27T12:00:00.000Z',
				outcome: 'success',
				failedProviders: [],
				results: { s3: { success: true, capabilities: {} } }
			});
		}
	);
	return { settingsWrites, syncBodies };
}

test.describe('Back up now lets you choose the providers for this one backup', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('switches start from the saved settings, photo-only storage is left out, and only the chosen ids are sent', async ({
		page
	}) => {
		const { settingsWrites, syncBodies } = await mockStorage(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/settings/storage');

		await page.getByRole('button', { name: 'Back up now' }).click();
		const dialog = page.getByRole('dialog', { name: 'Back up now' });
		const drive = dialog.getByRole('switch', { name: 'Back up to Family Drive' });
		const s3 = dialog.getByRole('switch', { name: 'Back up to Office S3' });
		await expect(drive).toHaveAttribute('aria-checked', 'true');
		await expect(s3).toHaveAttribute('aria-checked', 'false');
		await expect(dialog.getByText('Holiday Photos')).toHaveCount(0);

		await drive.click();
		await s3.click();
		await dialog.getByRole('button', { name: 'Back up to 1 place' }).click();

		await expect.poll(() => syncBodies.length).toBe(1);
		expect(syncBodies[0]).toMatchObject({
			syncTypes: ['backup'],
			force: true,
			providerIds: ['s3']
		});
		expect(settingsWrites).toEqual([]);
	});

	test('keeping the saved choice sends no provider list, as before', async ({ page }) => {
		const { syncBodies } = await mockStorage(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/settings/storage');

		await page.getByRole('button', { name: 'Back up now' }).click();
		await page
			.getByRole('dialog', { name: 'Back up now' })
			.getByRole('button', { name: 'Back up to 1 place' })
			.click();

		await expect.poll(() => syncBodies.length).toBe(1);
		expect(syncBodies[0]).not.toHaveProperty('providerIds');
	});
});
