/**
 * VLM receipt-parsing API client (vlm-receipt-parsing T5a — the fork-free FE slice).
 *
 * A thin typed wrapper over the already-shipped, contract-fixed `POST /api/v1/receipts/parse`
 * (backend T4): upload a receipt image (multipart), get back a DRAFT expense the user confirms. This
 * is independent of the gated forks — D1 (which adapters ship), D3 (confidence UX), D4 (provenance),
 * D5 (cap value) — so it carries zero rework risk regardless of how those land. The settings provider
 * UI + the "Scan receipt" button (the eyes-on, D1/D3-dependent parts of T5/T6) stay gated.
 *
 * The draft is in DOLLARS (the backend keeps it in major units; cents convert only at the POST
 * /expenses boundary), and it is NEVER auto-written — the caller pre-fills the expense form with it.
 */

import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';

/**
 * A receipt-parse draft — the bounded, fail-closed extraction the backend returns. Every field is
 * optional: the model omits anything it could not read, and the backend drops anything that fails
 * validation, so a consumer must treat each field as "maybe present" and let the user fill the rest.
 */
export interface ReceiptDraft {
	/** Receipt grand total in DOLLARS (major units), if read. */
	amount?: number;
	/** Transaction date as an ISO calendar date "YYYY-MM-DD", if read. */
	date?: string;
	/** Odometer reading (non-negative integer), if printed on the receipt. */
	odometer?: number;
	/** Best-fit category, guaranteed to be one of the six ExpenseCategory values if present. */
	category?: ExpenseCategory;
	/** Merchant / station name, if printed. */
	vendor?: string;
}

export const vlmApi = {
	/**
	 * Parse a receipt image into a draft expense. Uploads the image as multipart form-data to the
	 * backend, which calls the user's configured VLM provider and returns a validated draft. Throws an
	 * ApiError (via the shared client) on a non-2xx — e.g. 400 if no VLM provider is configured, 502 if
	 * the provider could not be reached — so the caller can show an actionable message + a manual-entry
	 * fallback. PERSISTS NOTHING: the returned draft pre-fills the expense form; the user confirms it.
	 */
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
