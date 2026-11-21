import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getProviders = vi.hoisted(() => vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>());

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders }
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

import PendingPhotoPreview from '../PendingPhotoPreview.svelte';

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	getProviders.mockResolvedValue([
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
	URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
	URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
	URL.createObjectURL = realCreateObjectURL;
	URL.revokeObjectURL = realRevokeObjectURL;
});

function mount(files: File[]) {
	const onAdd = vi.fn<(file: File) => void>();
	const onRemove = vi.fn<(index: number) => void>();
	const view = render(PendingPhotoPreview, { files, onAdd, onRemove });
	return { ...view, onAdd, onRemove };
}

const photo = new File(['jpg'], 'pump.jpg', { type: 'image/jpeg' });
const receipt = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });

describe('PendingPhotoPreview', () => {
	test('explains that queued files upload on save when nothing is queued', () => {
		mount([]);

		expect(
			screen.getByText("Add photos or receipts. They'll upload when you save.")
		).toBeInTheDocument();
	});

	test('previews images and names non-image files', () => {
		mount([photo, receipt]);

		expect(screen.getByAltText('pump.jpg')).toHaveAttribute('src', 'blob:pump.jpg');
		expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(screen.getByText('2 files queued. Will upload on save.')).toBeInTheDocument();
	});

	test('a single queued file is counted in the singular', () => {
		mount([receipt]);

		expect(screen.getByText('1 file queued. Will upload on save.')).toBeInTheDocument();
	});

	test('removing a file reports its index', async () => {
		const { onRemove } = mount([photo, receipt]);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove receipt.pdf' }));

		expect(onRemove).toHaveBeenCalledWith(1);
	});

	test('revokes preview URLs when the previews go away', () => {
		const { unmount } = mount([photo, receipt]);

		unmount();

		expect(revokeObjectURL).toHaveBeenCalledWith('blob:pump.jpg');
		expect(revokeObjectURL).toHaveBeenCalledTimes(1);
	});

	test('files picked in the add dialog are queued instead of uploaded', async () => {
		const { onAdd } = mount([]);

		await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByText('Add Photos & Receipts')).toBeInTheDocument();
		const input = (await waitFor(() => {
			const el = document.querySelector('input[type="file"]');
			expect(el).not.toBeNull();
			return el;
		})) as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [photo, receipt], configurable: true });
		await fireEvent.change(input);
		await fireEvent.click(screen.getByRole('button', { name: 'Upload (2)' }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
		expect(onAdd).toHaveBeenNthCalledWith(1, photo);
		expect(onAdd).toHaveBeenNthCalledWith(2, receipt);
		expect(await screen.findByText('Upload complete')).toBeInTheDocument();
	});
});
