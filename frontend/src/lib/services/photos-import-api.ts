import type { ReceiptDraft } from './vlm-api';
import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';
import { toBackendExpense } from './api-transformer';

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
			'/api/v1/photos/receipt-drafts'
		);
		return drafts;
	},

	async confirmDraft(photoId: string, input: ConfirmDraftInput): Promise<{ id: string }> {
		const backendExpense = toBackendExpense(input);
		return apiClient.post<{ id: string }>('/api/v1/expenses', {
			...backendExpense,
			clientId: `photos:${photoId}`
		});
	}
};
