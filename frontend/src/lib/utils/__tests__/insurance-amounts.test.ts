import { describe, expect, test } from 'vitest';
import { enteredAmount, getDaysRemaining, getLatestTerm } from '../insurance';

describe('enteredAmount', () => {
	test.each([null, undefined, ''])('treats %j as not entered', value => {
		expect(enteredAmount(value)).toBeUndefined();
	});

	test.each([
		['120.50', 120.5],
		[0, 0],
		['0', 0]
	])('reads %j as %d', (value, amount) => {
		expect(enteredAmount(value)).toBe(amount);
	});

	test.each(['abc', 'Infinity'])('rejects the non-finite input %j', value => {
		expect(enteredAmount(value)).toBeUndefined();
	});
});

describe('getDaysRemaining', () => {
	const now = new Date(2024, 5, 10, 15, 30);

	test('counts calendar days to a Date end', () => {
		expect(getDaysRemaining(new Date(2024, 5, 20, 1, 0), now)).toBe(10);
	});

	test('counts calendar days to a full timestamp end', () => {
		expect(getDaysRemaining(new Date(2024, 5, 9, 23, 0).toISOString(), now)).toBe(-1);
	});
});

describe('getLatestTerm', () => {
	test('returns undefined when there are no terms', () => {
		expect(getLatestTerm([])).toBeUndefined();
	});
});
