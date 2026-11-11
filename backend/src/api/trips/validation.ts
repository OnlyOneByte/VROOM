import { z } from 'zod';

/** The purposes a trip may carry. The mileage summary buckets miles by these values. */
export const TRIP_PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

const startEndRefine = (data: { startOdometer?: number; endOdometer?: number }): boolean =>
  // Partial updates may send one odometer; the rule applies only when both are present.
  data.startOdometer === undefined ||
  data.endOdometer === undefined ||
  data.endOdometer >= data.startOdometer;

const REFINE_MSG = {
  message: 'endOdometer must be greater than or equal to startOdometer',
  path: ['endOdometer'],
};

/**
 * Future means a later local calendar day. The client anchors dates at local noon, so an instant
 * comparison would reject today's trip before noon on the server clock.
 */
const notFutureLocalDay = (d: Date): boolean => {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return d.getTime() <= endOfToday.getTime();
};

const FUTURE_MSG = { message: 'tripDate cannot be in the future' };

// vehicleId is checked for ownership in the route. Refined schemas cannot be .extend()ed, so it lives here.
export const createTripSchema = z
  .object({
    vehicleId: z.string().min(1, 'vehicleId is required'),
    startOdometer: z.number().int().min(0, 'startOdometer must be a non-negative integer'),
    endOdometer: z.number().int().min(0, 'endOdometer must be a non-negative integer'),
    purpose: z.enum(TRIP_PURPOSES),
    tripDate: z.coerce.date().refine(notFutureLocalDay, FUTURE_MSG),
    startLocation: z.string().max(200).optional(),
    endLocation: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(startEndRefine, REFINE_MSG);

export const updateTripSchema = z
  .object({
    startOdometer: z.number().int().min(0).optional(),
    endOdometer: z.number().int().min(0).optional(),
    purpose: z.enum(TRIP_PURPOSES).optional(),
    tripDate: z.coerce.date().refine(notFutureLocalDay, FUTURE_MSG).optional(),
    startLocation: z.string().max(200).nullish(),
    endLocation: z.string().max(200).nullish(),
    note: z.string().max(500).nullish(),
  })
  .refine(startEndRefine, REFINE_MSG);
