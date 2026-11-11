/**
 * Imports receipts from the VROOM Photos album as expenses. Money stays in dollars until the
 * POST /expenses boundary. The clientId is spread onto the body directly because toBackendExpense
 * does not carry it.
 */

import type { ReceiptDraft } from './vlm-api';
import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';
import { toBackendExpense } from './api-transformer';

export interface ReceiptDraftItem {
	/** Google Photos media-item id; also the dedup key (`clientId = photos:<photoId>`). */
	photoId: string;
	/** Empty when the VLM could not read the receipt. */
	draft: ReceiptDraft;
	/** Short-lived; null if it could not be resolved. */
	thumbnailUrl: string | null;
}

export interface ConfirmDraftInput {
	vehicleId: string;
	category: ExpenseCategory;
	/** Dollars (major units) — the draft amount, possibly edited by the user. */
	amount: number;
	date?: string;
	mileage?: number;
	volume?: number;
	description?: string;
}

export const photosImportApi = {
	// Throws ApiError on non-2xx (400 when the google-photos or vlm provider is missing, 502 when Photos is unreadable).
	async getReceiptDrafts(): Promise<ReceiptDraftItem[]> {
		const { drafts } = await apiClient.get<{ drafts: ReceiptDraftItem[] }>(
			'/api/v1/photos/receipt-drafts'
		);
		return drafts;
	},

	// Re-confirming the same photo is a no-op because clientId is the idempotency key.
	async confirmDraft(photoId: string, input: ConfirmDraftInput): Promise<{ id: string }> {
		const backendExpense = toBackendExpense(input);
		return apiClient.post<{ id: string }>('/api/v1/expenses', {
			...backendExpense,
			clientId: `photos:${photoId}`
		});
	}
};
