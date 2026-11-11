import type { ExpenseFormData } from './expense-form-data';

/** Duplicate-tag input arrives comma-separated; trim, drop blanks, and apply the 10-tag cap. */
export function parsePreselectedTags(raw: string): string[] {
	return raw
		.split(',')
		.map(t => t.trim())
		.filter(Boolean)
		.slice(0, 10);
}

/**
 * Query for a new-expense page seeded from this one. The date is omitted on purpose: a duplicate is
 * the next occurrence of a recurring expense, not a copy.
 */
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
