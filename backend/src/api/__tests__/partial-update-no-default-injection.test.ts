/**
 * Class-level guard for the `.partial()` + `.default()` silent-data-loss class (C31/C34, scoped C35;
 * net committed C41).
 *
 * THE CLASS: a Zod `.default(x)` SURVIVES `.partial()`. So an update schema built as
 * `base.partial()` injects `x` on an update request that OMITS that field — and because update
 * handlers write the parsed object straight through to `repository.update`, it silently CLOBBERS the
 * stored value. It bit twice: C31 (reminders triggerMode reverted mileage→time) and C34 (expense
 * tags wiped on any edit). Per-instance behavioral guards cover those; THIS is the forward-looking
 * net that catches the NEXT one.
 *
 * THE INVARIANT (tested directly against the real exported schemas): parsing an EMPTY update `{}`
 * must inject no key that would overwrite a stored value. A surviving default is the only thing that
 * adds a key to `parse({})` on a `.partial()` schema — so any key here is a default, and it must be
 * on the EXEMPT allowlist (a literal-single-value default clobbers nothing — C35 verified
 * `actionMode: z.literal('automatic').default('automatic')` is harmless: there's no other value a
 * user could have set). A NEW `.partial()` update schema that injects a user-settable default fails
 * this test with an actionable message.
 *
 * Scope note (C35, verified): only HAND-WRITTEN Zod `.default()` is in scope — drizzle-zod
 * createInsertSchema does NOT surface `.notNull().default()` DB columns as Zod defaults. Update
 * schemas that are hand-built `z.object(...)` (not `base.partial()`) — updateTerm/Policy/Claim —
 * can't carry a surviving default unless one is written, so they're covered by the same assertion.
 * C179: `updateVehicleSchema` is a `createInsertSchema(vehiclesTable).omit(...).partial()` over a table
 * with FOUR .default() columns (vehicleType/trackFuel/trackCharging/unitPreferences) — the highest-risk
 * createInsertSchema-based instance. Added here (it had to be EXPORTED from the route to assert against
 * it) so the drizzle-zod-doesn't-surface-defaults assumption is PINNED, not just documented: if a future
 * drizzle-zod bump (or a hand-added .default()) ever started injecting `vehicleType:'gas'`/`trackFuel`,
 * a PUT editing only the nickname would silently revert an EV to gas — this test would catch it.
 */

import { describe, expect, test } from 'bun:test';
import { updateClaimSchema } from '../insurance/claims-validation';
import { updatePolicySchema, updateTermSchema } from '../insurance/validation';
import { updateReminderSchema } from '../reminders/validation';
import { updateVehicleSchema } from '../vehicles/routes';

// A default key is allowed ONLY if injecting its fixed value can't clobber a user choice (a
// literal-single-value default). Keep this list tiny + justified — adding to it is a deliberate
// assertion that the field has exactly one legal value.
const EXEMPT_DEFAULT_KEYS = new Set<string>([
  // reminders: actionMode is z.literal('automatic').default('automatic') — one legal value (C35).
  'actionMode',
]);

const UPDATE_SCHEMAS: Array<{ name: string; schema: { safeParse: (v: unknown) => unknown } }> = [
  { name: 'updateReminderSchema', schema: updateReminderSchema },
  { name: 'updateTermSchema', schema: updateTermSchema },
  { name: 'updatePolicySchema', schema: updatePolicySchema },
  { name: 'updateClaimSchema', schema: updateClaimSchema },
  { name: 'updateVehicleSchema', schema: updateVehicleSchema },
];

describe('update schemas inject no clobbering default on an empty update (.partial()+.default() class)', () => {
  for (const { name, schema } of UPDATE_SCHEMAS) {
    test(`${name}: parse({}) injects no user-settable default`, () => {
      const result = schema.safeParse({}) as
        | { success: true; data: Record<string, unknown> }
        | { success: false };

      // Some update schemas .refine(keys > 0) so an empty update legitimately FAILS to parse — that's
      // fine (it injects nothing, and the route rejects an empty body). Only inspect injected keys
      // when the empty object parsed successfully.
      if (!result.success) return;

      const injected = Object.keys(result.data).filter((k) => !EXEMPT_DEFAULT_KEYS.has(k));
      expect(
        injected,
        `${name} injects ${injected.join(', ')} on an empty update — a Zod .default() survived ` +
          `.partial() and would CLOBBER the stored value(s) on any unrelated edit (the C31/C34 ` +
          `data-loss class). Re-declare the field as a plain .optional() (no default) in the update ` +
          `schema via .extend(), or — if its value is a single literal that can't clobber — add it to ` +
          `EXEMPT_DEFAULT_KEYS with a one-line justification.`
      ).toEqual([]);
    });
  }
});
