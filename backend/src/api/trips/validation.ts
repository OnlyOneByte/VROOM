import { z } from 'zod';

// The mileage summary buckets miles by these values: a new purpose needs a bucket there too.
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

// Compare by local calendar day: clients anchor trip dates at local noon.
const notFutureLocalDay = (d: Date): boolean => {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return d.getTime() <= endOfToday.getTime();
};

const FUTURE_MSG = { message: 'tripDate cannot be in the future' };

// Zod refined schemas cannot be .extend()ed, so vehicleId is declared here; the route checks ownership.
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
