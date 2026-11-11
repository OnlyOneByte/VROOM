import { DistanceUnit, VolumeUnit } from '../types';

const MILES_TO_KM = 1.609344;
const GALLONS_US_TO_LITERS = 3.785411784;
const GALLONS_UK_TO_LITERS = 4.54609;

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

// Efficiency is distance per volume, so the distance factor multiplies and the volume factor
// divides.
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
