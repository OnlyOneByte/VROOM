import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { triggerBlobDownload } from '$lib/utils/download';

describe('triggerBlobDownload', () => {
	let createObjectURL: ReturnType<typeof vi.fn>;
	let revokeObjectURL: ReturnType<typeof vi.fn>;
	let clickSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		createObjectURL = vi.fn(() => 'blob:mock-url');
		revokeObjectURL = vi.fn();
		window.URL.createObjectURL = createObjectURL as unknown as typeof window.URL.createObjectURL;
		window.URL.revokeObjectURL = revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;
		clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('creates an anchor with the object-URL href + filename, clicks it, then cleans up', () => {
		const blob = new Blob(['hello'], { type: 'text/csv' });

		triggerBlobDownload(blob, 'report.csv');

		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		expect(document.querySelector('a[download]')).toBeNull();
	});

	test('sets the download attribute to the provided filename', () => {
		let downloadName: string | null = null;
		clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
			downloadName = this.getAttribute('download');
		});

		triggerBlobDownload(new Blob(['x']), 'vroom-backup-2024.zip');

		expect(downloadName).toBe('vroom-backup-2024.zip');
	});
});
