import { z } from 'zod';
import { CONFIG } from '../../config';
import { isValidTimeZone } from '../../utils/time-zone';
import {
  dateInput,
  MAX_ODOMETER_READING,
  noonAnchoredDateIsNotInTheFuture,
  ODOMETER_TOO_HIGH_MESSAGE,
  WHOLE_DISTANCE_MESSAGE,
} from '../../utils/validation';

// The trip summary buckets distance by these values: a new purpose needs a bucket there too.
export const TRIP_PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

const startEndRefine = (data: { startOdometer?: number; endOdometer?: number }): boolean =>
  data.startOdometer === undefined ||
  data.endOdometer === undefined ||
  data.endOdometer >= data.startOdometer;

const REFINE_MSG = {
  message: 'endOdometer must be greater than or equal to startOdometer',
  path: ['endOdometer'],
};

const FUTURE_MSG = { message: 'tripDate cannot be in the future' };

const tripOdometer = (field: string) =>
  z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0, `${field} must be a non-negative integer`)
    .max(MAX_ODOMETER_READING, ODOMETER_TOO_HIGH_MESSAGE);

export const tripTimeZoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, 'Unknown time zone')
  .optional();

// Zod refined schemas cannot be .extend()ed, so vehicleId is declared here; the route checks ownership.
export const createTripSchema = z
  .object({
    vehicleId: z.string().min(1, 'vehicleId is required'),
    startOdometer: tripOdometer('startOdometer'),
    endOdometer: tripOdometer('endOdometer'),
    purpose: z.enum(TRIP_PURPOSES),
    tripDate: dateInput.refine(noonAnchoredDateIsNotInTheFuture, FUTURE_MSG),
    startLocation: z.string().max(200).optional(),
    endLocation: z.string().max(200).optional(),
    note: z.string().max(CONFIG.validation.trip.noteMaxLength).optional(),
    timeZone: tripTimeZoneSchema,
  })
  .refine(startEndRefine, REFINE_MSG);

export const updateTripSchema = z
  .object({
    startOdometer: tripOdometer('startOdometer').optional(),
    endOdometer: tripOdometer('endOdometer').optional(),
    purpose: z.enum(TRIP_PURPOSES).optional(),
    tripDate: dateInput.refine(noonAnchoredDateIsNotInTheFuture, FUTURE_MSG).optional(),
    startLocation: z.string().max(200).nullish(),
    endLocation: z.string().max(200).nullish(),
    note: z.string().max(CONFIG.validation.trip.noteMaxLength).nullish(),
    timeZone: tripTimeZoneSchema,
  })
  .refine(startEndRefine, REFINE_MSG);
