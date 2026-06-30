/**
 * Photos → auto-expense import API client (photos-auto-expense T3 — the fork-free FE slice).
 *
 * A thin typed wrapper over the shipped backend stage endpoint:
 *   - `getReceiptDrafts()` → GET /api/v1/photos/receipt-drafts → the list of staged drafts (the backend
 *     walked VROOM's app-created Photos album, parsed each through the user's VLM, filtered out
 *     already-imported photos, and PERSISTED NOTHING — design §2).
 *   - `confirmDraft(item, vehicleId, overrides?)` → reuses the UNCHANGED POST /expenses with
 *     `clientId = photos:<mediaItemId>` so a re-import is idempotent (the shipped createIdempotent unique
 *     index, design §3). The user reviews + edits each draft before confirming; nothing is auto-written.
 *
 * Money stays DOLLARS through the draft (the backend keeps major units; cents convert only at the POST
 * /expenses boundary). The clientId is spread onto the backend body directly — the same path the
 * offline-sync writer uses (sync-manager.ts) — because `toBackendExpense` does not carry the key.
 */

import type { ReceiptDraft } from './vlm-api';
import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';
import { toBackendExpense } from './api-transformer';

/** One staged receipt from the backend: the source photo + the (maybe-empty) draft + a fresh thumbnail. */
export interface ReceiptDraftItem {
	/** The Google Photos media-item id — also the dedup key (`clientId = photos:<photoId>`). */
	photoId: string;
	/** The fail-closed draft (empty when the VLM could not read this one — the user fills it by hand). */
	draft: ReceiptDraft;
	/** A fresh (short-lived) baseUrl for the review thumbnail, or null if it could not be resolved. */
	thumbnailUrl: string | null;
}

/** The fields a user can supply/override on confirm (the draft pre-fills them; the vehicle is required). */
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
	/**
	 * Fetch the staged receipt drafts from the user's VROOM Photos album. Throws an ApiError (via the
	 * shared client) on a non-2xx — 400 if the google-photos or vlm provider is missing, 502 if Photos
	 * could not be read — so the caller can show an actionable message + a retry. PERSISTS NOTHING.
	 */
	async getReceiptDrafts(): Promise<ReceiptDraftItem[]> {
		const { drafts } = await apiClient.get<{ drafts: ReceiptDraftItem[] }>(
			'/api/v1/photos/receipt-drafts'
		);
		return drafts;
	},

	/**
	 * Confirm ONE reviewed draft into an expense via the UNCHANGED POST /expenses, keyed on
	 * `clientId = photos:<photoId>` so re-confirming the same photo is a no-op (idempotency, D3/R5). The
	 * photo links to the created expense via the existing expense_receipts flow server-side. Returns the
	 * created (or idempotently-existing) expense row.
	 */
	async confirmDraft(photoId: string, input: ConfirmDraftInput): Promise<{ id: string }> {
		const backendExpense = toBackendExpense(input);
		// Spread the clientId on directly (toBackendExpense does not carry it) — the offline-sync precedent.
		return apiClient.post<{ id: string }>('/api/v1/expenses', {
			...backendExpense,
			clientId: `photos:${photoId}`
		});
	}
};
