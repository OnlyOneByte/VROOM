import { describe, expect, test } from 'vitest';
import { derivePushStatus, pushStatusLabel, type PushStatus, type PushStatusInput } from '../push';

const base: PushStatusInput = {
	supported: true,
	configured: true,
	permission: 'granted',
	subscribed: false
};

describe('derivePushStatus precedence', () => {
	test('unsupported wins over everything (even a live subscription)', () => {
		expect(
			derivePushStatus({ ...base, supported: false, subscribed: true, permission: 'granted' })
		).toBe('unsupported');
	});

	test('unconfigured (503) wins over a denied/subscribed state when supported', () => {
		expect(derivePushStatus({ ...base, configured: false, permission: 'denied' })).toBe(
			'unconfigured'
		);
		expect(derivePushStatus({ ...base, configured: false, subscribed: true })).toBe('unconfigured');
	});

	test('denied wins over subscribed once supported + configured', () => {
		expect(derivePushStatus({ ...base, permission: 'denied', subscribed: true })).toBe('denied');
	});

	test('subscribed when supported + configured + not blocked + an active subscription', () => {
		expect(derivePushStatus({ ...base, permission: 'granted', subscribed: true })).toBe(
			'subscribed'
		);
	});

	test("off when supported + configured + not blocked but not yet subscribed (permission 'default')", () => {
		expect(derivePushStatus({ ...base, permission: 'default', subscribed: false })).toBe('off');
		expect(derivePushStatus({ ...base, permission: 'granted', subscribed: false })).toBe('off');
	});
});

describe('pushStatusLabel', () => {
	const statuses: PushStatus[] = [
		'unsupported',
		'unconfigured',
		'denied',
		'subscribed',
		'off',
		'error'
	];

	test('every status has a non-empty label', () => {
		for (const s of statuses) {
			expect(pushStatusLabel(s).length).toBeGreaterThan(0);
		}
	});

	test('the subscribed label does not promise scheduled delivery', () => {
		const label = pushStatusLabel('subscribed').toLowerCase();
		expect(label).toContain('reminder check');
		expect(label).not.toContain('every day');
		expect(label).not.toContain('scheduled');
	});

	test('the denied label tells the user to un-block in browser settings', () => {
		expect(pushStatusLabel('denied').toLowerCase()).toContain('blocked');
	});
});
