import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { PaginatedResponse, Photo, UserProviderInfo } from '#lib/types/index.ts';

const mocks = vi.hoisted(() => ({
	getPhotos:
		vi.fn<(entityType: 'expense', entityId: string) => Promise<PaginatedResponse<Photo>>>(),
	uploadPhoto: vi.fn<(entityType: 'expense', entityId: string, file: File) => Promise<Photo>>(),
	deletePhoto: vi.fn<(entityType: 'expense', entityId: string, photoId: string) => Promise<void>>(),
	getProviders: vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>(),
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getPhotos: mocks.getPhotos,
		uploadPhoto: mocks.uploadPhoto,
		deletePhoto: mocks.deletePhoto,
		getPhotoThumbnailUrl: (_type: string, entityId: string, photoId: string) =>
			`/thumbs/${entityId}/${photoId}`
	}
}));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: mocks.getProviders }
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification: mocks.addNotification }
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

import ExpensePhotoSection from '../ExpensePhotoSection.svelte';

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
	return {
		id,
		entityType: 'expense',
		entityId: 'e1',
		fileName: `${id}.jpg`,
		mimeType: 'image/jpeg',
		fileSize: 1024,
		isCover: false,
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

function page(data: Photo[]): PaginatedResponse<Photo> {
	return { data, pagination: { totalCount: data.length, limit: 50, offset: 0, hasMore: false } };
}

function mount() {
	return render(ExpensePhotoSection, { entityType: 'expense', entityId: 'e1' });
}

function deleteButtons(): HTMLButtonElement[] {
	return screen.getAllByRole('button', { name: /^Delete p\d+\.jpg$/ }) as HTMLButtonElement[];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getPhotos.mockResolvedValue(page([]));
	mocks.getProviders.mockResolvedValue([
		{
			id: 'p1',
			domain: 'storage',
			providerType: 'google-drive',
			displayName: 'Drive',
			status: 'active',
			config: {},
			createdAt: '2026-01-01T00:00:00Z'
		}
	]);
});

describe('ExpensePhotoSection: loading', () => {
	test('loads the expense photos on mount and shows an empty state when there are none', async () => {
		mount();

		expect(await screen.findByText('No photos or receipts yet.')).toBeInTheDocument();
		expect(mocks.getPhotos).toHaveBeenCalledWith('expense', 'e1');
	});

	test('shows image thumbnails and names PDF receipts instead of previewing them', async () => {
		mocks.getPhotos.mockResolvedValue(
			page([photo('img1'), photo('doc1', { mimeType: 'application/pdf', fileName: 'receipt.pdf' })])
		);
		mount();

		expect(await screen.findByAltText('img1.jpg')).toHaveAttribute('src', '/thumbs/e1/img1');
		expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
		expect(screen.queryByAltText('receipt.pdf')).toBeNull();
	});

	test('a failed load notifies the user and falls back to the empty state', async () => {
		mocks.getPhotos.mockRejectedValue(new Error('offline'));
		mount();

		expect(await screen.findByText('No photos or receipts yet.')).toBeInTheDocument();
		expect(mocks.addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining('Failed to load photos')
			})
		);
	});
});

describe('ExpensePhotoSection: uploading', () => {
	test('an uploaded photo is added to the grid', async () => {
		const uploaded = photo('new1');
		mocks.uploadPhoto.mockResolvedValue(uploaded);
		mount();
		await screen.findByText('No photos or receipts yet.');

		await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
		expect(await screen.findByText('Upload Photos & Receipts')).toBeInTheDocument();
		expect(await screen.findByText(/JPEG, PNG, WebP, PDF/)).toBeInTheDocument();

		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File(['img'], 'new1.jpg', { type: 'image/jpeg' });
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		await fireEvent.change(input);
		await fireEvent.click(screen.getByRole('button', { name: 'Upload (1)' }));

		await waitFor(() => expect(mocks.uploadPhoto).toHaveBeenCalledWith('expense', 'e1', file));
		expect(await screen.findByAltText('new1.jpg')).toBeInTheDocument();
	});
});

describe('ExpensePhotoSection: deleting', () => {
	test('a confirmed delete removes the photo', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1'), photo('p2')]));
		mocks.deletePhoto.mockResolvedValue();
		mount();
		await screen.findByAltText('p2.jpg');

		await fireEvent.click(deleteButtons()[1] as HTMLButtonElement);
		expect(await screen.findByText('Delete photo?')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByAltText('p2.jpg')).toBeNull());
		expect(mocks.deletePhoto).toHaveBeenCalledWith('expense', 'e1', 'p2');
		expect(screen.getByAltText('p1.jpg')).toBeInTheDocument();
	});

	test('a failed delete keeps the photo, notifies, and leaves the confirmation open', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1')]));
		mocks.deletePhoto.mockRejectedValue(new Error('storage offline'));
		mount();
		await screen.findByAltText('p1.jpg');

		await fireEvent.click(deleteButtons()[0] as HTMLButtonElement);
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() =>
			expect(mocks.addNotification).toHaveBeenCalledWith(
				expect.objectContaining({ message: expect.stringContaining('Failed to delete photo') })
			)
		);
		expect(screen.getByAltText('p1.jpg')).toBeInTheDocument();
		expect(screen.getByText('Delete photo?')).toBeInTheDocument();
	});
});
