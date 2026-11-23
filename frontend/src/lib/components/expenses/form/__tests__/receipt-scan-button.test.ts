import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReceiptDraft } from '#lib/services/vlm-api.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const parseReceipt = vi.hoisted(() => vi.fn<(image: File) => Promise<ReceiptDraft>>());

vi.mock('#lib/services/vlm-api.ts', () => ({
	vlmApi: { parseReceipt }
}));

import ReceiptScanButton from '../ReceiptScanButton.svelte';

const DISCLOSURE_KEY = 'vroom.vlm.receipt-scan-disclosed';
const DRAFT: ReceiptDraft = { amount: 42.5, date: '2026-03-01', category: 'fuel', vendor: 'Shell' };

function mount() {
	const onDraft = vi.fn<(draft: ReceiptDraft, image: File) => void>();
	render(ReceiptScanButton, { onDraft });
	return { onDraft };
}

function fileInput(): HTMLInputElement {
	return screen.getByTestId('receipt-scan-input') as HTMLInputElement;
}

function scanButton(): HTMLElement {
	return screen.getByTestId('receipt-scan-button');
}

async function pickReceipt(file = new File(['jpg'], 'receipt.jpg', { type: 'image/jpeg' })) {
	Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true });
	await fireEvent.change(fileInput());
	return file;
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	parseReceipt.mockResolvedValue(DRAFT);
});

describe('ReceiptScanButton: privacy disclosure', () => {
	test('the first scan explains where the photo goes before opening the picker', async () => {
		mount();
		const click = vi.spyOn(fileInput(), 'click');

		await fireEvent.click(scanButton());

		expect(await screen.findByText('Scan a receipt with AI')).toBeInTheDocument();
		expect(click).not.toHaveBeenCalled();
	});

	test('continuing remembers the acknowledgement and opens the picker', async () => {
		mount();
		const click = vi.spyOn(fileInput(), 'click');
		await fireEvent.click(scanButton());

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

		expect(localStorage.setItem).toHaveBeenCalledWith(DISCLOSURE_KEY, '1');
		expect(click).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByText('Scan a receipt with AI')).toBeNull());
	});

	test('continuing still opens the picker when storage is unavailable', async () => {
		mount();
		const click = vi.spyOn(fileInput(), 'click');
		vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
			throw new Error('QuotaExceededError');
		});
		await fireEvent.click(scanButton());

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

		expect(click).toHaveBeenCalledOnce();
	});

	test('cancelling the disclosure does not open the picker', async () => {
		mount();
		const click = vi.spyOn(fileInput(), 'click');
		await fireEvent.click(scanButton());

		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		expect(click).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByText('Scan a receipt with AI')).toBeNull());
	});

	test('once acknowledged, scanning goes straight to the picker', async () => {
		localStorage.setItem(DISCLOSURE_KEY, '1');
		mount();
		const click = vi.spyOn(fileInput(), 'click');

		await fireEvent.click(scanButton());

		expect(click).toHaveBeenCalledOnce();
		expect(screen.queryByText('Scan a receipt with AI')).toBeNull();
	});
});

describe('ReceiptScanButton: scanning', () => {
	test('only accepts images and prefers the rear camera', () => {
		mount();

		expect(fileInput().accept).toBe('image/jpeg,image/png,image/webp');
		expect(fileInput().getAttribute('capture')).toBe('environment');
	});

	test('a parsed receipt is handed back with its image', async () => {
		const { onDraft } = mount();

		const file = await pickReceipt();

		await waitFor(() => expect(onDraft).toHaveBeenCalledWith(DRAFT, file));
		expect(parseReceipt).toHaveBeenCalledWith(file);
		expect(fileInput().value).toBe('');
	});

	test('shows a busy state while the receipt is read', async () => {
		let finish: (draft: ReceiptDraft) => void = () => {};
		parseReceipt.mockImplementation(
			() =>
				new Promise(resolve => {
					finish = resolve;
				})
		);
		mount();

		await pickReceipt();

		expect(scanButton()).toHaveTextContent('Reading receipt…');
		expect(scanButton()).toBeDisabled();
		finish(DRAFT);
		await waitFor(() => expect(scanButton()).toHaveTextContent('Scan receipt'));
	});

	test('an empty pick does not scan', async () => {
		mount();
		Object.defineProperty(fileInput(), 'files', { value: [], configurable: true });

		await fireEvent.change(fileInput());

		expect(parseReceipt).not.toHaveBeenCalled();
	});
});

describe('ReceiptScanButton: errors', () => {
	test.each([
		[
			'missing provider (NO_PROVIDER)',
			new ApiError('Bad Request', 400, { capability: 'ai.vision' }, 'NO_PROVIDER'),
			'No receipt-parsing provider is set up yet. Add one in Settings → Receipt Parsing.'
		],
		[
			'another 400, such as an unreadable image',
			new ApiError('No image file provided', 400),
			"Couldn't read the receipt. No image file provided. Or fill it in manually."
		],
		[
			'unreachable provider (502)',
			new ApiError('Bad Gateway', 502),
			"Couldn't reach the AI provider. Check the key and model, or fill it in manually."
		],
		[
			'other API',
			new ApiError('Image too blurry', 422),
			"Couldn't read the receipt. Image too blurry. Or fill it in manually."
		],
		[
			'non-Error',
			'weird',
			"Couldn't read the receipt. Something went wrong. Try again, and reload the page if it keeps happening. Or fill it in manually."
		]
	])('a %s failure explains what to do', async (_label, error, message) => {
		parseReceipt.mockRejectedValue(error);
		const { onDraft } = mount();

		await pickReceipt();

		expect(await screen.findByTestId('receipt-scan-error')).toHaveTextContent(message);
		expect(onDraft).not.toHaveBeenCalled();
	});

	test('a server failure hides the raw error text', async () => {
		parseReceipt.mockRejectedValue(new ApiError('ECONNRESET upstream vlm worker', 500));
		mount();

		await pickReceipt();

		const error = await screen.findByTestId('receipt-scan-error');
		expect(error).toHaveTextContent("Couldn't read the receipt. Something went wrong on our side.");
		expect(error).not.toHaveTextContent('ECONNRESET');
	});

	test('Try again re-scans the same image and clears the error on success', async () => {
		parseReceipt.mockRejectedValueOnce(new ApiError('Bad Gateway', 502));
		const { onDraft } = mount();
		const file = await pickReceipt();
		await screen.findByTestId('receipt-scan-error');

		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

		await waitFor(() => expect(onDraft).toHaveBeenCalledWith(DRAFT, file));
		expect(parseReceipt).toHaveBeenCalledTimes(2);
		expect(screen.queryByTestId('receipt-scan-error')).toBeNull();
	});

	test('starting a new scan clears the previous error', async () => {
		localStorage.setItem(DISCLOSURE_KEY, '1');
		parseReceipt.mockRejectedValueOnce(new Error('nope'));
		mount();
		vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
		await pickReceipt();
		await screen.findByTestId('receipt-scan-error');

		await fireEvent.click(scanButton());

		expect(screen.queryByTestId('receipt-scan-error')).toBeNull();
	});
});
