import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import CameraTab from '../CameraTab.svelte';

interface FakeTrack {
	stop: ReturnType<typeof vi.fn>;
}

function fakeStream(): MediaStream {
	const tracks: FakeTrack[] = [{ stop: vi.fn() }];
	return { getTracks: () => tracks } as unknown as MediaStream;
}

interface FakeConstraints {
	video?: boolean | { facingMode?: string };
	audio?: boolean;
}

const getUserMedia = vi.fn<(constraints: FakeConstraints) => Promise<MediaStream>>();
const createObjectURL = vi.fn(() => 'blob:capture-1');
const revokeObjectURL = vi.fn();

const realMediaDevices = navigator.mediaDevices;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realPlay = HTMLVideoElement.prototype.play;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

function installMediaDevices(value: unknown): void {
	Object.defineProperty(navigator, 'mediaDevices', {
		value,
		configurable: true,
		writable: true
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	getUserMedia.mockImplementation(async () => fakeStream());
	installMediaDevices({ getUserMedia });
	URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
	URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
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
		callback(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
	}) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
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
	props: Partial<{
		uploadErrors: string[];
		onUploadCapture: (file: File) => Promise<void>;
		onClose: () => void;
	}> = {}
) {
	const onUploadCapture = props.onUploadCapture ?? vi.fn(async () => {});
	const onClose = props.onClose ?? vi.fn();
	const view = render(CameraTab, {
		uploadErrors: props.uploadErrors ?? [],
		onUploadCapture,
		onClose
	});
	return { ...view, onUploadCapture, onClose };
}

async function waitForViewfinder(): Promise<HTMLElement> {
	await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled(), {
		timeout: 2000
	});
	return screen.getByRole('button', { name: 'Take photo' });
}

describe('CameraTab: camera access errors', () => {
	test('explains when the browser has no camera API', async () => {
		installMediaDevices(undefined);
		mount();

		expect(await screen.findByText('Camera is not supported in this browser.')).toBeInTheDocument();
		expect(getUserMedia).not.toHaveBeenCalled();
	});

	test.each([
		['NotAllowedError', 'Camera access was denied. Please allow camera permissions and try again.'],
		['NotFoundError', 'No camera found on this device.'],
		['AbortError', "Couldn't access the camera. Try again."]
	])('a %s is reported as a readable message', async (name, message) => {
		getUserMedia.mockRejectedValue(new DOMException('nope', name));
		mount();

		expect(await screen.findByText(message)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
	});

	test('a non-DOM failure falls back to the generic message', async () => {
		getUserMedia.mockRejectedValue(new Error('boom'));
		mount();

		expect(await screen.findByText("Couldn't access the camera. Try again.")).toBeInTheDocument();
	});

	test.each(['OverconstrainedError', 'NotReadableError'])(
		'a %s retries without a facing mode and opens the viewfinder',
		async name => {
			getUserMedia
				.mockRejectedValueOnce(new DOMException('constrained', name))
				.mockImplementation(async () => fakeStream());
			mount();

			await waitForViewfinder();

			expect(getUserMedia).toHaveBeenCalledTimes(2);
			const fallback = getUserMedia.mock.calls[1]?.[0];
			expect(fallback?.video).not.toHaveProperty('facingMode');
		}
	);

	test('a failed fallback attempt shows the generic error', async () => {
		getUserMedia
			.mockRejectedValueOnce(new DOMException('constrained', 'OverconstrainedError'))
			.mockRejectedValueOnce(new Error('still no'));
		mount();

		expect(await screen.findByText("Couldn't access the camera. Try again.")).toBeInTheDocument();
	});

	test('Try Again reopens the camera after an error', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('nope', 'NotAllowedError'));
		mount();
		await fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));

		await waitForViewfinder();

		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(screen.queryByText(/Camera access was denied/)).toBeNull();
	});
});

describe('CameraTab: capturing', () => {
	test('the shutter stays disabled until the camera is ready', () => {
		getUserMedia.mockImplementation(() => new Promise(() => {}));
		mount();

		expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Switch camera' })).toBeDisabled();
	});

	test('taking a photo shows the preview and stops the live stream', async () => {
		const stream = fakeStream();
		getUserMedia.mockResolvedValue(stream);
		mount();

		await fireEvent.click(await waitForViewfinder());

		expect(await screen.findByAltText('Captured preview')).toHaveAttribute('src', 'blob:capture-1');
		expect(stream.getTracks()[0]?.stop).toHaveBeenCalled();
	});

	test('the captured photo is handed over as a JPEG file', async () => {
		const { onUploadCapture } = mount();
		await fireEvent.click(await waitForViewfinder());

		await fireEvent.click(await screen.findByRole('button', { name: 'Use Photo' }));

		await waitFor(() => expect(onUploadCapture).toHaveBeenCalledOnce());
		const file = vi.mocked(onUploadCapture).mock.calls[0]?.[0];
		expect(file?.type).toBe('image/jpeg');
		expect(file?.name).toMatch(/^capture-.*\.jpg$/);
	});

	test('retaking discards the preview and reopens the camera', async () => {
		mount();
		await fireEvent.click(await waitForViewfinder());

		await fireEvent.click(await screen.findByRole('button', { name: 'Retake' }));

		await waitForViewfinder();
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:capture-1');
		expect(screen.queryByAltText('Captured preview')).toBeNull();
		expect(getUserMedia).toHaveBeenCalledTimes(2);
	});

	test('no preview appears when the canvas yields no image', async () => {
		HTMLCanvasElement.prototype.toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
			callback(null);
		}) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
		mount();

		await fireEvent.click(await waitForViewfinder());

		expect(screen.queryByAltText('Captured preview')).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	test('no preview appears when the canvas has no 2d context', async () => {
		HTMLCanvasElement.prototype.getContext = vi.fn(
			() => null
		) as unknown as typeof HTMLCanvasElement.prototype.getContext;
		mount();

		await fireEvent.click(await waitForViewfinder());

		expect(screen.queryByAltText('Captured preview')).toBeNull();
	});
});

describe('CameraTab: controls and errors', () => {
	test('cancel calls onClose', async () => {
		const { onClose } = mount();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(onClose).toHaveBeenCalledOnce();
	});

	test('lists upload errors passed in by the dialog', () => {
		mount({ uploadErrors: ['Storage is full'] });

		expect(screen.getByText('Storage is full')).toBeInTheDocument();
	});

	test('unmounting stops the stream and revokes an unused capture', async () => {
		const stream = fakeStream();
		getUserMedia.mockResolvedValue(stream);
		const { unmount } = mount();
		await waitForViewfinder();

		unmount();

		expect(stream.getTracks()[0]?.stop).toHaveBeenCalled();
	});

	test('switching cameras retries a transient failure with a growing backoff', async () => {
		mount();
		await waitForViewfinder();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			getUserMedia
				.mockRejectedValueOnce(new Error('busy'))
				.mockRejectedValueOnce(new Error('busy'))
				.mockImplementation(async () => fakeStream());

			await fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
			await vi.advanceTimersByTimeAsync(99);
			expect(getUserMedia).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(getUserMedia).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(199);
			expect(getUserMedia).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(1);
			expect(getUserMedia).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(50);

			expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
			expect(screen.queryByText("Couldn't access the camera. Try again.")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	test('switching cameras stops retrying after three transient failures', async () => {
		mount();
		await waitForViewfinder();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			getUserMedia.mockRejectedValue(new Error('busy'));

			await fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
			await vi.advanceTimersByTimeAsync(300);
			expect(getUserMedia).toHaveBeenCalledTimes(4);
			expect(screen.getByText("Couldn't access the camera. Try again.")).toBeInTheDocument();

			await vi.advanceTimersByTimeAsync(10_000);
			expect(getUserMedia).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});

	test('switching cameras gives up at once on a permission error', async () => {
		mount();
		await waitForViewfinder();
		getUserMedia.mockRejectedValue(new DOMException('nope', 'NotAllowedError'));

		await fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));

		expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument();
		expect(getUserMedia).toHaveBeenCalledTimes(2);
	});
});
