import { describe, expect, test } from 'vitest';
import { createEmptyFormData } from '../expense-form-data';
import {
	buildDuplicateQuery,
	buildInsuranceEditQuery,
	parsePreselectedTags
} from '../expense-navigation';

describe('parsePreselectedTags', () => {
	test('trims each tag and drops blanks', () => {
		expect(parsePreselectedTags(' fuel , ,  road trip ,')).toEqual(['fuel', 'road trip']);
	});

	test('caps the list at ten tags', () => {
		const raw = Array.from({ length: 12 }, (_, i) => `t${i}`).join(',');
		const tags = parsePreselectedTags(raw);
		expect(tags).toHaveLength(10);
		expect(tags[9]).toBe('t9');
	});
});

describe('buildDuplicateQuery', () => {
	test('carries the entry fields forward and always returns to the caller', () => {
		const form = {
			...createEmptyFormData(new Date('2026-03-01T12:00:00')),
			vehicleId: 'v1',
			category: 'fuel',
			amount: '42.50',
			description: 'Shell',
			tags: ['fuel', 'road trip']
		};
		expect(buildDuplicateQuery('/vehicles/v1', form)).toEqual({
			returnTo: '/vehicles/v1',
			vehicleId: 'v1',
			category: 'fuel',
			amount: '42.50',
			description: 'Shell',
			tags: 'fuel,road trip'
		});
	});

	test('omits the date, so a duplicate starts on today as the next occurrence', () => {
		const query = buildDuplicateQuery('/expenses', createEmptyFormData());
		expect(query).not.toHaveProperty('date');
	});

	test('omits empty fields rather than sending blanks', () => {
		expect(buildDuplicateQuery('/expenses', createEmptyFormData())).toEqual({
			returnTo: '/expenses'
		});
	});
});

describe('buildInsuranceEditQuery', () => {
	test('opens the policy and the term being edited', () => {
		expect(buildInsuranceEditQuery('p1', 'insurance_term', 't1')).toEqual({
			policy: 'p1',
			editTerm: 't1'
		});
	});

	test('only names the term when the expense came from an insurance term', () => {
		expect(buildInsuranceEditQuery('p1', 'financing', 't1')).toEqual({ policy: 'p1' });
	});

	test('an expense with no policy yields no query', () => {
		expect(buildInsuranceEditQuery(null, null, null)).toEqual({});
	});
});
