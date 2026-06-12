/**
 * Unit tests for triggerBlobDownload — the browser "save as" helper extracted (C278) from the two
 * byte-identical sites (expense-api CSV export + settings-store backup download). Pins the mechanics
 * the dedup must preserve: a same-named anchor is created with the object-URL href + the given
 * download filename, clicked, then the URL is revoked and the anchor removed (no DOM leak).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { triggerBlobDownload } from '$lib/utils/download';

describe('triggerBlobDownload', () => {
	let createObjectURL: ReturnType<typeof vi.fn>;
	let revokeObjectURL: ReturnType<typeof vi.fn>;
	let clickSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		createObjectURL = vi.fn(() => 'blob:mock-url');
		revokeObjectURL = vi.fn();
		// jsdom doesn't implement the object-URL APIs — stub them on window.URL.
		window.URL.createObjectURL = createObjectURL as unknown as typeof window.URL.createObjectURL;
		window.URL.revokeObjectURL = revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;
		// Anchor.click() in jsdom would attempt navigation; spy it to a no-op + capture the call.
		clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('creates an anchor with the object-URL href + filename, clicks it, then cleans up', () => {
		const blob = new Blob(['hello'], { type: 'text/csv' });

		triggerBlobDownload(blob, 'report.csv');

		// The blob was turned into an object URL, and that URL was later revoked (no leak).
		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		// The anchor is removed from the DOM (no orphan element left behind).
		expect(document.querySelector('a[download]')).toBeNull();
	});

	test('sets the download attribute to the provided filename', () => {
		// Capture the anchor at click time (it is removed immediately after).
		let downloadName: string | null = null;
		clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
			downloadName = this.getAttribute('download');
		});

		triggerBlobDownload(new Blob(['x']), 'vroom-backup-2024.zip');

		expect(downloadName).toBe('vroom-backup-2024.zip');
	});
});
