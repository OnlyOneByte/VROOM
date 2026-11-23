import type { ReceiptDraft } from './vlm-api';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { apiClient } from './api-client';
import { toBackendExpense } from './api-transformer';
import { userTimeZone } from './analytics-api';

export interface ReceiptDraftItem {
	photoId: string;
	draft: ReceiptDraft;
	thumbnailUrl: string | null;
}

export interface ConfirmDraftInput {
	vehicleId: string;
	category: ExpenseCategory;
	amount: number;
	date?: string;
	mileage?: number;
	volume?: number;
	description?: string;
}

export const photosImportApi = {
	async getReceiptDrafts(): Promise<ReceiptDraftItem[]> {
		const { drafts } = await apiClient.get<{ drafts: ReceiptDraftItem[] }>(
			'/photos/receipt-drafts'
		);
		return drafts;
	},

	async confirmDraft(photoId: string, input: ConfirmDraftInput): Promise<{ id: string }> {
		const backendExpense = toBackendExpense(input);
		return apiClient.post<{ id: string }>('/expenses', {
			...backendExpense,
			clientId: `photos:${photoId}`,
			timeZone: userTimeZone()
		});
	}
};
