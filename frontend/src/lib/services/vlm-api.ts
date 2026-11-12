import type { ExpenseCategory } from '$lib/types';
import { apiClient } from './api-client';

export interface ReceiptDraft {
	amount?: number;
	date?: string;
	odometer?: number;
	category?: ExpenseCategory;
	vendor?: string;
}

export const vlmApi = {
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
