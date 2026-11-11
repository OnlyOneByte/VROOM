/**
 * Receipt-parse client. The draft is in DOLLARS (cents convert only at the POST /expenses boundary)
 * and is never saved automatically; the caller pre-fills the expense form with it.
 */

import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';

/** Every field is optional: anything unreadable or invalid is dropped, so the user fills the gaps. */
export interface ReceiptDraft {
	/** Receipt grand total in DOLLARS (major units), if read. */
	amount?: number;
	/** Transaction date as an ISO calendar date "YYYY-MM-DD", if read. */
	date?: string;
	/** Odometer reading (non-negative integer), if printed on the receipt. */
	odometer?: number;
	category?: ExpenseCategory;
	vendor?: string;
}

export const vlmApi = {
	// Throws ApiError on non-2xx (e.g. 400 when no VLM provider is configured, 502 when unreachable).
	async parseReceipt(image: File): Promise<ReceiptDraft> {
		const formData = new FormData();
		formData.append('image', image);
		const { draft } = await apiClient.post<{ draft: ReceiptDraft }>(
			'/api/v1/receipts/parse',
			formData
		);
		return draft;
	}
};
