import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Photo } from '#lib/types/index.ts';

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getPhotoThumbnailUrl: (vehicleId: string, photoId: string) => `/thumbs/${vehicleId}/${photoId}`
	}
}));

import VehiclePhotoCarousel from '../VehiclePhotoCarousel.svelte';

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
	return {
		id,
		entityType: 'vehicle',
		entityId: 'v1',
		fileName: `${id}.jpg`,
		mimeType: 'image/jpeg',
		fileSize: 1024,
		isCover: false,
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

function mount(
	photos: Photo[],
	overrides: Partial<{
		isOwner: boolean;
		onDelete: (photoId: string) => void | Promise<void>;
	}> = {}
) {
	const onUpload = vi.fn();
	const onDelete = overrides.onDelete ?? vi.fn(async () => {});
	const onSetCover = vi.fn();
	const view = render(VehiclePhotoCarousel, {
		vehicleId: 'v1',
		photos,
		onUpload,
		onDelete,
		onSetCover,
		...(overrides.isOwner !== undefined ? { isOwner: overrides.isOwner } : {})
	});
	return { ...view, onUpload, onDelete, onSetCover };
}

function deleteButtonFor(fileName: string): HTMLButtonElement {
	const img = screen.getByAltText(fileName);
	const card = img.parentElement as HTMLElement;
	const buttons = card.querySelectorAll('button');
	return buttons[buttons.length - 1] as HTMLButtonElement;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('VehiclePhotoCarousel: empty state', () => {
	test('an owner with no photos is invited to upload', async () => {
		const { onUpload } = mount([]);

		expect(screen.getByText('No photos yet')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));

		expect(onUpload).toHaveBeenCalledOnce();
	});

	test('a viewer with no photos sees no upload buttons', () => {
		mount([], { isOwner: false });

		expect(screen.getByText('No photos yet')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
	});
});

describe('VehiclePhotoCarousel: photos', () => {
	test('shows each photo thumbnail, loading only the first eagerly', () => {
		mount([photo('p1'), photo('p2')]);

		const first = screen.getByAltText('p1.jpg');
		const second = screen.getByAltText('p2.jpg');
		expect(first).toHaveAttribute('src', '/thumbs/v1/p1');
		expect(first).toHaveAttribute('loading', 'eager');
		expect(second).toHaveAttribute('loading', 'lazy');
		expect(screen.getByText('1 of 2 photos')).toBeInTheDocument();
	});

	test('a single photo has no navigation dots and a singular count', () => {
		mount([photo('p1')]);

		expect(screen.getByText('1 of 1 photo')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Go to photo 1' })).toBeNull();
	});

	test('several photos get one navigation dot each', () => {
		mount([photo('p1'), photo('p2'), photo('p3')]);

		expect(screen.getByRole('button', { name: 'Go to photo 1' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Go to photo 3' })).toBeInTheDocument();
	});

	test('the header upload button calls onUpload', async () => {
		const { onUpload } = mount([photo('p1')]);

		await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

		expect(onUpload).toHaveBeenCalledOnce();
	});
});

describe('VehiclePhotoCarousel: cover photo', () => {
	test('badges the cover photo and offers to promote only the others', async () => {
		const { onSetCover } = mount([photo('p1', { isCover: true }), photo('p2')]);

		expect(screen.getAllByText('Cover')).toHaveLength(1);
		const setCover = screen.getAllByRole('button', { name: 'Set as cover' });
		expect(setCover).toHaveLength(1);

		await fireEvent.click(setCover[0] as HTMLElement);

		expect(onSetCover).toHaveBeenCalledWith('p2');
	});

	test('a viewer sees the cover badge but no photo actions', () => {
		mount([photo('p1', { isCover: true }), photo('p2')], { isOwner: false });

		expect(screen.getByText('Cover')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Set as cover' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
	});
});

describe('VehiclePhotoCarousel: deleting', () => {
	test('asks for confirmation before deleting a photo', async () => {
		const { onDelete } = mount([photo('p1'), photo('p2')]);

		await fireEvent.click(deleteButtonFor('p2.jpg'));

		expect(await screen.findByText('Delete photo?')).toBeInTheDocument();
		expect(onDelete).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith('p2'));
	});

	test('disables the delete button while that photo is being deleted', async () => {
		let finish: () => void = () => {};
		const onDelete = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve;
				})
		);
		mount([photo('p1')], { onDelete });

		await fireEvent.click(deleteButtonFor('p1.jpg'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(deleteButtonFor('p1.jpg')).toBeDisabled());
		finish();
		await waitFor(() => expect(deleteButtonFor('p1.jpg')).toBeEnabled());
	});

	test('cancelling the confirmation keeps the photo', async () => {
		const { onDelete } = mount([photo('p1')]);

		await fireEvent.click(deleteButtonFor('p1.jpg'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		expect(onDelete).not.toHaveBeenCalled();
	});
});
