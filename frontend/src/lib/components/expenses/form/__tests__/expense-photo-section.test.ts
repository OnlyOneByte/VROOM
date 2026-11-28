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
import '#lib/components/common/MediaCaptureDialog.svelte';

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

	test('each photo delete button is 40px square at every width', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1')]));
		mount();
		await screen.findByAltText('p1.jpg');
		const button = deleteButtons()[0];
		expect(button).toHaveClass('size-10');
		expect(button?.className).not.toMatch(/\b(?:sm|md):(?:h|w|size)-/);
	});

	test('the delete button over a photo has its own fill in both themes, since outline has none', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1')]));
		mount();
		await screen.findByAltText('p1.jpg');
		expect(deleteButtons()[0]).toHaveClass('bg-background');
		expect(deleteButtons()[0]?.className).not.toMatch(/(^|\s)bg-transparent(\s|$)/);
	});

	test('a failed load notifies the user and falls back to the empty state', async () => {
		mocks.getPhotos.mockRejectedValue(new Error('offline'));
		mount();

		expect(await screen.findByText('No photos or receipts yet.')).toBeInTheDocument();
		expect(mocks.addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining("Couldn't load the photos")
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
		expect(await screen.findByText('Upload photos & receipts')).toBeInTheDocument();
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
				expect.objectContaining({ message: expect.stringContaining("Couldn't delete the photo") })
			)
		);
		expect(screen.getByAltText('p1.jpg')).toBeInTheDocument();
		expect(screen.getByText('Delete photo?')).toBeInTheDocument();
	});
	async function confirmDelete(index: number) {
		const button = deleteButtons()[index] as HTMLButtonElement;
		button.focus();
		await fireEvent.click(button);
		const dialog = await screen.findByRole('alertdialog');
		await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(screen.queryByText('Delete photo?')).toBeNull());
	}

	test('after a delete, focus moves to the next photo', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1'), photo('p2'), photo('p3')]));
		mocks.deletePhoto.mockResolvedValue();
		mount();
		await screen.findByAltText('p3.jpg');

		await confirmDelete(1);

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete p3.jpg' }))
		);
	});

	test('after deleting the last photo, focus moves to the previous one', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1'), photo('p2')]));
		mocks.deletePhoto.mockResolvedValue();
		mount();
		await screen.findByAltText('p2.jpg');

		await confirmDelete(1);

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete p1.jpg' }))
		);
	});

	test('after deleting the only photo, focus moves to Upload', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1')]));
		mocks.deletePhoto.mockResolvedValue();
		mount();
		await screen.findByAltText('p1.jpg');

		await confirmDelete(0);

		await screen.findByText('No photos or receipts yet.');
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Upload' }))
		);
	});

	test('cancelling the confirmation returns focus to the photo it was opened from', async () => {
		mocks.getPhotos.mockResolvedValue(page([photo('p1'), photo('p2')]));
		mount();
		await screen.findByAltText('p2.jpg');
		const button = deleteButtons()[1] as HTMLButtonElement;
		button.focus();

		await fireEvent.click(button);
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(document.activeElement).toBe(button));
		expect(mocks.deletePhoto).not.toHaveBeenCalled();
	});
});
