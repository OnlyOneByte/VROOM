import type { ExpenseCategory } from '#lib/types/index.ts';
import { apiClient } from './api-client';

export interface ReceiptDraft {
	amount?: number;
	date?: string;
	odometer?: number;
	category?: ExpenseCategory;
	vendor?: string;
	volume?: number;
	volumeUnit?: 'gallons_us' | 'liters';
	pricePerUnit?: number;
}

export const vlmApi = {
	async parseReceipt(image: File): Promise<ReceiptDraft> {
		const formData = new FormData();
		formData.append('image', image);
		const { draft } = await apiClient.post<{ draft: ReceiptDraft }>('/receipts/parse', formData);
		return draft;
	}
};
