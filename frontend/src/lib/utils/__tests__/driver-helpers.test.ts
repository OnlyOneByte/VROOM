import { afterEach, describe, expect, test } from 'vitest';
import type { Driver } from '#lib/types/index.ts';
import { defaultDriverId, driverColor, rememberDriver, showsDriverChip } from '../driver-helpers';

test('the chip shows only when the car shares and you may record drivers', () => {
	const share = (enabled: boolean, record: boolean) => ({
		carShare: { enabled, manage: false, record }
	});
	expect(showsDriverChip(share(true, true))).toBe(true);
	expect(showsDriverChip(share(true, false))).toBe(false);
	expect(showsDriverChip(share(false, true))).toBe(false);
	expect(showsDriverChip({ carShareEnabled: false })).toBe(false);
	expect(showsDriverChip({ carShareEnabled: true })).toBeUndefined();
	expect(showsDriverChip(undefined)).toBeUndefined();
});

const driver = (id: string, extra: Partial<Driver> = {}): Driver => ({
	id,
	guest: false,
	name: id,
	color: null,
	archived: false,
	...extra
});

const drivers = [
	driver('me', { userId: 'u-me' }),
	driver('sam'),
	driver('riley', { guest: true }),
	driver('gone', { archived: true })
];

afterEach(() => localStorage.clear());

describe('defaultDriverId', () => {
	test('defaults to the person logging, then to the last pick on this device', () => {
		expect(defaultDriverId('car', drivers, 'u-me')).toBe('me');
		rememberDriver('car', 'riley');
		expect(defaultDriverId('car', drivers, 'u-me')).toBe('riley');
		expect(defaultDriverId('other-car', drivers, 'u-me')).toBe('me');
	});

	test('ignores a remembered driver who was archived, and someone who is not a driver', () => {
		rememberDriver('car', 'gone');
		expect(defaultDriverId('car', drivers, 'u-me')).toBe('me');
		expect(defaultDriverId('car', drivers, 'u-stranger')).toBeNull();
	});
});

test('driverColor only trusts the chart palette slots', () => {
	expect(driverColor({ color: 'chart-3' })).toBe('var(--chart-3)');
	expect(driverColor({ color: 'red;background:url(x)' })).toBe('var(--muted-foreground)');
	expect(driverColor({ color: null })).toBe('var(--muted-foreground)');
});
