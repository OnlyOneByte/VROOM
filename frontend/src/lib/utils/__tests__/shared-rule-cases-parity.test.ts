import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { DistanceUnit, Reminder, VolumeUnit } from '#lib/types/index.ts';
import {
	calculateMileageEfficiency,
	MILES_PER_UNIT,
	US_GALLONS_PER_UNIT
} from '#lib/components/expenses/form/expense-form/mileage-efficiency.ts';
import { isReminderTimeDue } from '#lib/utils/reminder-helpers.ts';

const BACKEND_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../backend/src');

function readCases<T>(relativePath: string): T {
	return JSON.parse(readFileSync(resolve(BACKEND_SRC, relativePath), 'utf8')) as T;
}

const EFFICIENCY_CASES = readCases<
	{
		distance: number;
		amount: number;
		distanceUnit: DistanceUnit;
		volumeUnit: VolumeUnit;
		fuel: 'volume' | 'charge';
		efficiency: number | null;
	}[]
>('utils/__tests__/fuel-efficiency.cases.json');

const UNIT_FACTORS = readCases<{
	milesPerDistanceUnit: Record<DistanceUnit, number>;
	usGallonsPerVolumeUnit: Record<VolumeUnit, number>;
}>('utils/__tests__/unit-factors.cases.json');

const TIME_DUE_CASES = readCases<{ nextDueDate: string; now: string; due: boolean }[]>(
	'api/reminders/__tests__/reminder-time-due.cases.json'
);

const START_MILEAGE = 1000;

describe('fuel-efficiency.cases.json', () => {
	test.each(EFFICIENCY_CASES)(
		'$fuel: $distance $distanceUnit on $amount ($volumeUnit) is $efficiency',
		({ distance, amount, distanceUnit, volumeUnit, fuel, efficiency }) => {
			const result = calculateMileageEfficiency({
				category: 'fuel',
				mileage: String(START_MILEAGE + distance),
				previousMileage: START_MILEAGE,
				fuelType: fuel === 'charge' ? 'Electric' : 'Regular',
				volume: fuel === 'volume' ? String(amount) : '',
				charge: fuel === 'charge' ? String(amount) : '',
				distanceUnit,
				volumeUnit
			});
			const shown = fuel === 'charge' ? result?.calculatedEfficiency : result?.calculatedMpg;
			expect(shown ?? null).toBe(efficiency);
		}
	);
});

describe('unit-factors.cases.json', () => {
	test('miles per distance unit match the backend', () => {
		for (const [unit, miles] of Object.entries(UNIT_FACTORS.milesPerDistanceUnit)) {
			expect(MILES_PER_UNIT[unit as DistanceUnit]).toBeCloseTo(miles, 12);
		}
		expect(Object.keys(MILES_PER_UNIT).sort()).toEqual(
			Object.keys(UNIT_FACTORS.milesPerDistanceUnit).sort()
		);
	});

	test('US gallons per volume unit match the backend', () => {
		for (const [unit, gallons] of Object.entries(UNIT_FACTORS.usGallonsPerVolumeUnit)) {
			expect(US_GALLONS_PER_UNIT[unit as VolumeUnit]).toBeCloseTo(gallons, 12);
		}
		expect(Object.keys(US_GALLONS_PER_UNIT).sort()).toEqual(
			Object.keys(UNIT_FACTORS.usGallonsPerVolumeUnit).sort()
		);
	});
});

describe('reminder-time-due.cases.json', () => {
	test.each(TIME_DUE_CASES)('due $nextDueDate at $now is $due', ({ nextDueDate, now, due }) => {
		const reminder = { nextDueDate } as Reminder;
		expect(isReminderTimeDue(reminder, new Date(now).getTime())).toBe(due);
	});
});
