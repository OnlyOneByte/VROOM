/**
 * Trip route validation (trips-location T3, design §3).
 *
 * createTripSchema enforces the business rules the DB can't:
 *   - R2: endOdometer >= startOdometer (a cross-field refine — the reminders/validation.ts idiom). The
 *     stored distance is DERIVED (tripDistance, max(0,…)), but rejecting an inverted pair at the boundary
 *     keeps a nonsensical reading out of the DB rather than silently clamping it to 0.
 *   - D4: purpose is one of the four known values (a z.enum, not free text).
 *   - R5: tripDate is z.coerce.date() — same as expenses/odometer/reminders; the client sends an ISO
 *     instant (its local-day handling is dateOnlyToISO on the FE = NOON LOCAL), the server stores it. The
 *     future-guard rejects only a future LOCAL CALENDAR DAY (notFutureLocalDay) — not an absolute instant,
 *     which would 400 a today-trip sent as noon-local whenever the server clock is before local noon.
 *   - D5: startLocation/endLocation/note are optional free-text (no GPS in v1), length-bounded.
 *
 * The vehicleId is NOT in the body — it's a route param on POST /:vehicleId (the odometer/expenses idiom),
 * validated for ownership separately. updateTripSchema is the partial (every field optional) but KEEPS the
 * R2 refine so a PUT that sends BOTH odometers can't invert them (the refine only fires when both are present).
 */

import { z } from 'zod';

/** D4 — the four trip purposes. Exported so the FE/analytics (T5/T6) share one source of truth. */
export const TRIP_PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

const startEndRefine = (data: { startOdometer?: number; endOdometer?: number }): boolean =>
  // Only enforce when BOTH are present (so a partial update of one field alone passes here; the repo
  // row keeps the other). A full create always has both → the rule always applies on POST.
  data.startOdometer === undefined ||
  data.endOdometer === undefined ||
  data.endOdometer >= data.startOdometer;

const REFINE_MSG = {
  message: 'endOdometer must be greater than or equal to startOdometer',
  path: ['endOdometer'],
};

/**
 * R5 future-guard: reject a tripDate whose LOCAL CALENDAR DAY is after today's — NOT a bare
 * `d <= new Date()` absolute-instant comparison.
 *
 * The FE sends a date-only value anchored at NOON LOCAL (dateOnlyToISO, the C61/#39 discipline), so an
 * absolute-instant guard wrongly rejected a trip dated TODAY whenever the server clock was before local
 * noon — noon-local-today is then HOURS in the "future" relative to `now`, 400-ing the form's own default
 * (log today's trip) for the entire local morning, every day. R5 specifies local-calendar-day semantics, so
 * "in the future" means a calendar DAY after today: compare against the END of the current local day. (The
 * #87/#106/#39 date-off-by-one family — an instant comparison where a local-day one was intended.)
 */
const notFutureLocalDay = (d: Date): boolean => {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return d.getTime() <= endOfToday.getTime();
};

const FUTURE_MSG = { message: 'tripDate cannot be in the future' };

/** The trip fields a CREATE body carries, INCLUDING the owning vehicleId (validated for ownership in the
 * route). A refined schema can't be cleanly .extend()ed, so vehicleId lives in the object pre-refine. */
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

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
