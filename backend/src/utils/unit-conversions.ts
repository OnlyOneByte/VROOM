import { DistanceUnit, VolumeUnit } from '../types';

const MILES_TO_KM = 1.609344;
const GALLONS_US_TO_LITERS = 3.785411784;
const GALLONS_UK_TO_LITERS = 4.54609;

export const DISTANCE_UNIT_SHORT_LABELS: Record<DistanceUnit, string> = {
  [DistanceUnit.MILES]: 'mi',
  [DistanceUnit.KILOMETERS]: 'km',
};

export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value;

  if (from === DistanceUnit.MILES && to === DistanceUnit.KILOMETERS) {
    return value * MILES_TO_KM;
  }
  return value / MILES_TO_KM;
}

export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return value;

  const toLiters: Record<VolumeUnit, number> = {
    [VolumeUnit.GALLONS_US]: GALLONS_US_TO_LITERS,
    [VolumeUnit.GALLONS_UK]: GALLONS_UK_TO_LITERS,
    [VolumeUnit.LITERS]: 1,
  };

  const liters = value * toLiters[from];
  return liters / toLiters[to];
}

export function convertEfficiency(
  value: number,
  fromDist: DistanceUnit,
  fromVol: VolumeUnit,
  toDist: DistanceUnit,
  toVol: VolumeUnit
): number {
  if (fromDist === toDist && fromVol === toVol) return value;

  const distFactor = convertDistance(1, fromDist, toDist);
  const volFactor = convertVolume(1, fromVol, toVol);

  return (value * distFactor) / volFactor;
}

export interface UnitScale {
  distance: number;
  volume: number;
}

export const NATIVE_SCALE: UnitScale = { distance: 1, volume: 1 };

export function canonicalScale(units: {
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
}): UnitScale {
  return {
    distance: convertDistance(1, units.distanceUnit, DistanceUnit.MILES),
    volume: convertVolume(1, units.volumeUnit, VolumeUnit.GALLONS_US),
  };
}
