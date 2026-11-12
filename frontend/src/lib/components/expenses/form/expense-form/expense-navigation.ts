import type { ExpenseFormData } from './expense-form-data';

export function parsePreselectedTags(raw: string): string[] {
	return raw
		.split(',')
		.map(t => t.trim())
		.filter(Boolean)
		.slice(0, 10);
}

export function buildDuplicateQuery(
	returnTo: string,
	form: ExpenseFormData
): Record<string, string> {
	const query: Record<string, string> = { returnTo };
	if (form.vehicleId) query['vehicleId'] = form.vehicleId;
	if (form.category) query['category'] = form.category;
	if (form.amount) query['amount'] = form.amount;
	if (form.description) query['description'] = form.description;
	if (form.tags.length > 0) query['tags'] = form.tags.join(',');
	return query;
}

export function buildInsuranceEditQuery(
	policyId: string | null,
	sourceType: string | null,
	sourceId: string | null
): Record<string, string> {
	const query: Record<string, string> = {};
	if (policyId) query['policy'] = policyId;
	if (sourceType === 'insurance_term' && sourceId) query['editTerm'] = sourceId;
	return query;
}
