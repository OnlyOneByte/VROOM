import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const getProviders = vi.hoisted(() => vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>());

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders }
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

import MediaCaptureDialog from '../MediaCaptureDialog.svelte';

const DRIVE: UserProviderInfo = {
	id: 'p1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'My Drive',
	status: 'active',
	config: {},
	createdAt: '2026-01-01T00:00:00Z'
};

const realMediaDevices = navigator.mediaDevices;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realPlay = HTMLVideoElement.prototype.play;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

function installMediaDevices(value: unknown): void {
	Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true, writable: true });
}

function installCamera(): void {
	installMediaDevices({
		getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
	});
	URL.createObjectURL = vi.fn(() => 'blob:capture') as unknown as typeof URL.createObjectURL;
	URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
	HTMLVideoElement.prototype.play = vi.fn(
		async () => {}
	) as unknown as typeof HTMLVideoElement.prototype.play;
	Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
		configurable: true,
		get() {
			return this.__srcObject ?? null;
		},
		set(value: unknown) {
			this.__srcObject = value;
		}
	});
	HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
		drawImage: vi.fn()
	})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.toBlob = vi.fn((callback: (blob: Blob) => void) => {
		callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
	}) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}

beforeEach(() => {
	vi.clearAllMocks();
	getProviders.mockResolvedValue([DRIVE]);
	installMediaDevices(undefined);
});

afterEach(() => {
	installMediaDevices(realMediaDevices);
	URL.createObjectURL = realCreateObjectURL;
	URL.revokeObjectURL = realRevokeObjectURL;
	HTMLVideoElement.prototype.play = realPlay;
	HTMLCanvasElement.prototype.getContext = realGetContext;
	HTMLCanvasElement.prototype.toBlob = realToBlob;
	delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)['srcObject'];
});

function mount(
	overrides: Partial<{
		onUpload: (file: File) => Promise<unknown>;
		title: string;
		description: string;
		multiple: boolean;
	}> = {}
) {
	const onUpload = overrides.onUpload ?? vi.fn(async (file: File) => ({ name: file.name }));
	const onUploadComplete = vi.fn();
	const onClose = vi.fn();
	const view = render(MediaCaptureDialog, {
		open: true,
		onUpload,
		onUploadComplete,
		onClose,
		...(overrides.title ? { title: overrides.title } : {}),
		...(overrides.description ? { description: overrides.description } : {}),
		...(overrides.multiple !== undefined ? { multiple: overrides.multiple } : {})
	});
	return { ...view, onUpload, onUploadComplete, onClose };
}

function image(name: string): File {
	return new File(['img'], name, { type: 'image/jpeg' });
}

async function chooseFiles(...files: File[]): Promise<void> {
	const input = (await waitFor(() => {
		const el = document.querySelector('input[type="file"]');
		expect(el).not.toBeNull();
		return el;
	})) as HTMLInputElement;
	Object.defineProperty(input, 'files', { value: files, configurable: true });
	await fireEvent.change(input);
}

function uploadButton(): HTMLElement {
	return screen.getByRole('button', { name: /^Upload \(\d+\)$/ });
}

describe('MediaCaptureDialog: storage provider check', () => {
	test('asks for storage providers when opened and shows the upload tab', async () => {
		mount({ title: 'Receipt photos', description: 'Add receipts' });

		expect(screen.getByText('Receipt photos')).toBeInTheDocument();
		expect(screen.getByText('Add receipts')).toBeInTheDocument();
		await waitFor(() => expect(getProviders).toHaveBeenCalledWith('storage'));
		expect(await screen.findByText('Drop files here or click to browse')).toBeInTheDocument();
	});

	test('without a storage provider it points the user to Backups and storage instead', async () => {
		getProviders.mockResolvedValue([]);
		const { onClose } = mount();

		expect(await screen.findByText('No photo storage set up yet')).toBeInTheDocument();
		expect(screen.queryByText('Drop files here or click to browse')).toBeNull();
		const settings = screen.getByRole('link', { name: 'Set up storage' });
		expect(settings).toHaveAttribute('href', '/settings/storage');

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	test('a failed provider lookup still lets the user upload', async () => {
		getProviders.mockRejectedValue(new Error('offline'));
		mount();

		expect(await screen.findByText('Drop files here or click to browse')).toBeInTheDocument();
		expect(screen.queryByText('No photo storage set up yet')).toBeNull();
	});
});

describe('MediaCaptureDialog: uploading files', () => {
	test('uploads every selected file in order and reports completion', async () => {
		const { onUpload, onUploadComplete, onClose } = mount();
		const first = image('a.jpg');
		const second = image('b.jpg');
		await chooseFiles(first, second);

		await fireEvent.click(uploadButton());

		expect(await screen.findByText('Upload complete')).toBeInTheDocument();
		expect(onUpload).toHaveBeenNthCalledWith(1, first);
		expect(onUpload).toHaveBeenNthCalledWith(2, second);
		expect(onUploadComplete).toHaveBeenCalledWith({ name: 'a.jpg' });
		expect(onUploadComplete).toHaveBeenCalledWith({ name: 'b.jpg' });

		const footerClose = screen
			.getAllByRole('button', { name: 'Close' })
			.find(button => button.dataset['slot'] === 'button');
		await fireEvent.click(footerClose as HTMLElement);
		expect(onClose).toHaveBeenCalledOnce();
	});

	test('shows progress while a file is uploading', async () => {
		let finish: (value: unknown) => void = () => {};
		const onUpload = vi.fn(
			() =>
				new Promise(resolve => {
					finish = resolve;
				})
		);
		mount({ onUpload });
		await chooseFiles(image('a.jpg'));

		await fireEvent.click(uploadButton());

		expect(await screen.findByText('Uploading 1 of 1...')).toBeInTheDocument();
		finish({});
		expect(await screen.findByText('Upload complete')).toBeInTheDocument();
	});

	test('a partial failure lists the errors and how many succeeded', async () => {
		const onUpload = vi.fn(async (file: File) => {
			if (file.name === 'bad.jpg') throw new ApiError('Storage quota exceeded', 507);
			if (file.name === 'odd.jpg') throw 'not an error object';
			return {};
		});
		const { onUploadComplete } = mount({ onUpload });
		await chooseFiles(image('ok.jpg'), image('bad.jpg'), image('odd.jpg'));

		await fireEvent.click(uploadButton());

		expect(await screen.findByText('Upload complete (1 of 3 succeeded)')).toBeInTheDocument();
		expect(
			screen.getByText(`Couldn't upload "bad.jpg". ${SERVER_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
		expect(
			screen.getByText(`Couldn't upload "odd.jpg". ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
		expect(onUploadComplete).toHaveBeenCalledOnce();
	});

	test('reopening the dialog starts a fresh upload', async () => {
		const { rerender } = mount();
		await chooseFiles(image('a.jpg'));
		await fireEvent.click(uploadButton());
		await screen.findByText('Upload complete');

		await rerender({ open: false });
		await rerender({ open: true });

		expect(await screen.findByText('Drop files here or click to browse')).toBeInTheDocument();
		expect(screen.queryByText('Upload complete')).toBeNull();
		await waitFor(() => expect(getProviders).toHaveBeenCalledTimes(2));
	});
});

describe('MediaCaptureDialog: camera', () => {
	test('the camera tab is disabled when the browser has no camera', async () => {
		mount();

		expect(await screen.findByRole('tab', { name: 'Camera' })).toBeDisabled();
	});

	test('a captured photo is uploaded and closes the dialog', async () => {
		installCamera();
		const { onUpload, onUploadComplete, onClose } = mount();
		const tab = await screen.findByRole('tab', { name: 'Camera' });
		expect(tab).toBeEnabled();

		await fireEvent.mouseDown(tab);
		await fireEvent.click(tab);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
		await fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Use Photo' }));

		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
		expect(onUploadComplete).toHaveBeenCalledOnce();
	});

	test('a failed capture upload shows the error and keeps the dialog open', async () => {
		installCamera();
		const onUpload = vi.fn(async () => {
			throw new ApiError('Drive rejected the photo', 422);
		});
		const { onClose } = mount({ onUpload });
		const tab = await screen.findByRole('tab', { name: 'Camera' });

		await fireEvent.mouseDown(tab);
		await fireEvent.click(tab);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
		await fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Use Photo' }));

		const cameraPanel = await screen.findByRole('tabpanel');
		expect(
			await within(cameraPanel).findByText("Couldn't upload the photo. Drive rejected the photo.")
		).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByAltText('Captured preview')).toBeInTheDocument();
	});
});
