/**
 * Camera lifecycle: one hardware open per switch, and no blob URL left behind.
 *
 * Two defects, one root shape — the component did work twice, or not at all, because ownership of a
 * resource was unclear.
 *
 * 1. `startCamera` reads `facingMode` to build its getUserMedia constraints, so calling it from a
 *    tracked `$effect` body made the lifecycle effect depend on it. "Switch camera" wrote
 *    `facingMode` and restarted the camera itself, which ALSO invalidated the effect: its teardown
 *    stopped the stream the switch had just acquired and its body opened the hardware a second time.
 *    A generation counter kept the state correct, so the only symptom was a wasted camera
 *    acquisition — hundreds of milliseconds and a blanked viewfinder on a phone.
 * 2. `uploadCapture` cleared `capturedPreview` without revoking it, so the full-resolution JPEG
 *    behind the blob URL stayed resident for the life of the page — once per receipt uploaded. Only
 *    the upload path had this hole; retake, reset and unmount all revoked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock(
	'svelte',
	() => import('../../../../../../node_modules/svelte/src/index-client.js' as string)
);

const CameraTab = (await import('../CameraTab.svelte')).default;

interface FakeTrack {
	stop: ReturnType<typeof vi.fn>;
}
interface FakeStream {
	id: string;
	tracks: FakeTrack[];
	getTracks(): FakeTrack[];
}
interface FakeConstraints {
	video?: boolean | { facingMode?: string };
	audio?: boolean;
}

let streams: FakeStream[] = [];
let requestedFacingModes: (string | undefined)[] = [];
const getUserMedia = vi.fn(async (constraints: FakeConstraints) => {
	const video = constraints.video;
	requestedFacingModes.push(
		typeof video === 'object' && video !== null ? video.facingMode : undefined
	);
	const stream: FakeStream = {
		id: `stream-${streams.length + 1}`,
		tracks: [{ stop: vi.fn() }],
		getTracks() {
			return this.tracks;
		}
	};
	streams.push(stream);
	return stream as unknown as MediaStream;
});

const createObjectURL = vi.fn(() => 'blob:capture-1');
const revokeObjectURL = vi.fn();

const realMediaDevices = navigator.mediaDevices;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realPlay = HTMLVideoElement.prototype.play;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
	vi.clearAllMocks();
	streams = [];
	requestedFacingModes = [];

	Object.defineProperty(navigator, 'mediaDevices', {
		value: { getUserMedia },
		configurable: true,
		writable: true
	});
	URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
	URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
	HTMLVideoElement.prototype.play = vi.fn(
		async () => {}
	) as unknown as typeof HTMLVideoElement.prototype.play;
	// happy-dom's HTMLMediaElement.srcObject setter throws "not implemented", which the component
	// would report as a camera failure. Shadow it with a plain accessor.
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
	Object.defineProperty(navigator, 'mediaDevices', {
		value: realMediaDevices,
		configurable: true,
		writable: true
	});
	URL.createObjectURL = realCreateObjectURL;
	URL.revokeObjectURL = realRevokeObjectURL;
	HTMLVideoElement.prototype.play = realPlay;
	HTMLCanvasElement.prototype.getContext = realGetContext;
	HTMLCanvasElement.prototype.toBlob = realToBlob;
	delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)['srcObject'];
});

function mount(onUploadCapture = vi.fn(async () => {})) {
	const result = render(CameraTab, {
		props: { uploadErrors: [], onUploadCapture, onClose: vi.fn() }
	});
	return { ...result, onUploadCapture };
}

/** The viewfinder is live once the capture button is enabled (startCamera awaits a 50ms settle). */
async function waitForViewfinder(): Promise<HTMLElement> {
	const button = await screen.findByRole('button', { name: 'Take photo' });
	await waitFor(() => expect(button).toBeEnabled(), { timeout: 2000 });
	return button;
}

describe('switching cameras', () => {
	it('opens the hardware exactly once per switch', async () => {
		mount();
		await waitForViewfinder();
		expect(getUserMedia).toHaveBeenCalledTimes(1);

		await fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
		await waitForViewfinder();

		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(requestedFacingModes).toEqual(['environment', 'user']);
	});

	it('stops the superseded stream exactly once', async () => {
		mount();
		await waitForViewfinder();

		await fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
		await waitForViewfinder();

		expect(streams[0]?.tracks[0]?.stop).toHaveBeenCalledTimes(1);
		expect(streams[1]?.tracks[0]?.stop).not.toHaveBeenCalled();
	});
});

describe('uploading a capture', () => {
	it('revokes the captured blob URL once the upload succeeds', async () => {
		const { onUploadCapture } = mount();
		const capture = await waitForViewfinder();

		await fireEvent.click(capture);
		const usePhoto = await screen.findByRole('button', { name: /use photo/i });
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).not.toHaveBeenCalled();

		await fireEvent.click(usePhoto);
		await waitFor(() => expect(onUploadCapture).toHaveBeenCalledTimes(1));

		expect(revokeObjectURL).toHaveBeenCalledWith('blob:capture-1');
	});

	it('keeps the capture, and its URL, when the upload fails', async () => {
		const onUploadCapture = vi.fn(async () => {
			throw new Error('upload failed');
		});
		mount(onUploadCapture);
		const capture = await waitForViewfinder();

		await fireEvent.click(capture);
		const usePhoto = await screen.findByRole('button', { name: /use photo/i });

		await fireEvent.click(usePhoto);
		await waitFor(() => expect(onUploadCapture).toHaveBeenCalledTimes(1));

		expect(revokeObjectURL).not.toHaveBeenCalled();
		expect(screen.getByAltText('Captured preview')).toBeInTheDocument();
	});
});
