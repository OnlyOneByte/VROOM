import { describe, expect, test } from 'vitest';
import type { InsurancePolicy, InsuranceTerm } from '#lib/types/index.ts';
import { groupPoliciesByActive, isPolicyInForce } from '#lib/utils/insurance.ts';

const NOW = new Date('2026-11-21T12:00:00.000Z');

function term(id: string, startDate: string, endDate: string): InsuranceTerm {
	return {
		id,
		policyId: 'p',
		startDate,
		endDate,
		createdAt: startDate,
		updatedAt: startDate
	};
}

function policy(id: string, isActive: boolean, terms: InsuranceTerm[]): InsurancePolicy {
	return {
		id,
		company: id,
		isActive,
		terms,
		vehicleIds: [],
		termVehicleCoverage: [],
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

const expired = policy('expired', true, [term('t1', '2023-07-01', '2024-06-30')]);
const current = policy('current', true, [
	term('t2', '2025-06-01', '2025-12-01'),
	term('t3', '2026-06-01', '2027-06-01')
]);
const upcoming = policy('upcoming', true, [term('t4', '2026-12-01', '2027-12-01')]);
const deactivated = policy('deactivated', false, [term('t5', '2026-06-01', '2027-06-01')]);

describe('isPolicyInForce', () => {
	test('a policy whose only term has ended is not in force even when flagged active', () => {
		expect(isPolicyInForce(expired, NOW)).toBe(false);
	});

	test('a current or upcoming term keeps an active policy in force', () => {
		expect(isPolicyInForce(current, NOW)).toBe(true);
		expect(isPolicyInForce(upcoming, NOW)).toBe(true);
	});

	test('a manually deactivated policy is never in force', () => {
		expect(isPolicyInForce(deactivated, NOW)).toBe(false);
	});
});

describe('groupPoliciesByActive', () => {
	test('expired policies are grouped with inactive ones, not under Active Policies', () => {
		const { active, inactive } = groupPoliciesByActive(
			[expired, current, upcoming, deactivated],
			NOW
		);
		expect(active.map(p => p.id)).toEqual(['current', 'upcoming']);
		expect(inactive.map(p => p.id)).toEqual(['expired', 'deactivated']);
	});
});
