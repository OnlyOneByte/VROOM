import { describe, expect, test } from 'bun:test';
import TIME_DUE_CASES from '../../api/reminders/__tests__/reminder-time-due.cases.json';
import { isTimeDue } from '../../api/reminders/trigger-service';
import { DistanceUnit, VolumeUnit } from '../../types';
import { averageConsecutiveMpg, calculateAverageMilesPerKwh } from '../calculations';
import { canonicalScale, convertDistance, convertVolume } from '../unit-conversions';
import EFFICIENCY_CASES from './fuel-efficiency.cases.json';
import UNIT_FACTORS from './unit-factors.cases.json';

const START_MILEAGE = 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('fuel-efficiency.cases.json', () => {
  test.each(EFFICIENCY_CASES)(
    '$fuel: $distance $distanceUnit on $amount ($volumeUnit) is $efficiency',
    ({ distance, amount, distanceUnit, volumeUnit, fuel, efficiency }) => {
      const scale = canonicalScale({
        distanceUnit: distanceUnit as DistanceUnit,
        volumeUnit: volumeUnit as VolumeUnit,
      });
      const fills = [
        { mileage: START_MILEAGE, volume: amount, missedFillup: false, date: '2026-05-01' },
        {
          mileage: START_MILEAGE + distance,
          volume: amount,
          missedFillup: false,
          date: '2026-05-08',
        },
      ];
      const result =
        fuel === 'charge'
          ? calculateAverageMilesPerKwh(fills, scale)
          : averageConsecutiveMpg(fills, scale);
      expect(result === null ? null : round2(result)).toBe(efficiency);
    }
  );
});

describe('unit-factors.cases.json', () => {
  test.each(Object.entries(UNIT_FACTORS.milesPerDistanceUnit))(
    '1 %s is %d miles',
    (unit, miles) => {
      expect(convertDistance(1, unit as DistanceUnit, DistanceUnit.MILES)).toBeCloseTo(miles, 12);
    }
  );

  test.each(Object.entries(UNIT_FACTORS.usGallonsPerVolumeUnit))(
    '1 %s is %d US gallons',
    (unit, gallons) => {
      expect(convertVolume(1, unit as VolumeUnit, VolumeUnit.GALLONS_US)).toBeCloseTo(gallons, 12);
    }
  );
});

describe('reminder-time-due.cases.json', () => {
  test.each(TIME_DUE_CASES)(
    'due $nextDueDate at $now in $timeZone is $due',
    ({ nextDueDate, now, timeZone, due }) => {
      expect(isTimeDue(new Date(nextDueDate), new Date(now), timeZone)).toBe(due);
    }
  );
});
