/**
 * Class-level guard for the `.partial()` + `.default()` silent-data-loss class.
 *
 * THE CLASS: a Zod `.default(x)` SURVIVES `.partial()`. So an update schema built as
 * `base.partial()` injects `x` on an update request that OMITS that field — and because update
 * handlers write the parsed object straight through to `repository.update`, it silently CLOBBERS the
 * stored value. It has bitten twice: reminder triggerMode reverted mileage→time, and expense
 * tags were wiped on any edit. Per-instance behavioral guards cover those; THIS is the
 * forward-looking net that catches the NEXT one.
 *
 * THE INVARIANT (tested directly against the real exported schemas): parsing an EMPTY update `{}`
 * must inject no key that would overwrite a stored value. A surviving default is the only thing that
 * adds a key to `parse({})` on a `.partial()` schema — so any key here is a default, and it must be
 * on the EXEMPT allowlist (a literal-single-value default clobbers nothing — verified
 * `actionMode: z.literal('automatic').default('automatic')` is harmless: there's no other value a
 * user could have set). A NEW `.partial()` update schema that injects a user-settable default fails
 * this test with an actionable message.
 *
 * Scope note: only HAND-WRITTEN Zod `.default()` is in scope — drizzle-zod
 * createInsertSchema does NOT surface `.notNull().default()` DB columns as Zod defaults. Update
 * schemas that are hand-built `z.object(...)` (not `base.partial()`) — updateTerm/Policy/Claim —
 * can't carry a surviving default unless one is written, so they're covered by the same assertion.
 * `updateVehicleSchema` is a `createInsertSchema(vehiclesTable).omit(...).partial()` over a table
 * with FOUR .default() columns (vehicleType/trackFuel/trackCharging/unitPreferences) — the highest-risk
 * createInsertSchema-based instance. Added here (it had to be EXPORTED from the route to assert against
 * it) so the drizzle-zod-doesn't-surface-defaults assumption is PINNED, not just documented: if a future
 * drizzle-zod bump (or a hand-added .default()) ever started injecting `vehicleType:'gas'`/`trackFuel`,
 * a PUT editing only the nickname would silently revert an EV to gas — this test would catch it.
 */

import { expect } from 'bun:test';
import { ratchet } from '../../test-helpers/debt-ratchet';
import { updateClaimSchema } from '../insurance/claims-validation';
import { updatePolicySchema, updateTermSchema } from '../insurance/validation';
import { updateReminderSchema } from '../reminders/validation';
import { updateVehicleSchema } from '../vehicles/routes';

/**
 * Keys allowed to be injected, qualified by schema so an exemption cannot leak across schemas: a
 * bare `actionMode` would also exempt a future `actionMode` on a different, clobbering schema.
 *
 * A default key is allowed ONLY if injecting its fixed value cannot clobber a user choice — i.e. the
 * field has exactly one legal value. Keep this tiny and justified.
 */
const EXEMPT_DEFAULT_KEYS = [
  // actionMode is z.literal('automatic').default('automatic') — one legal value, so re-injecting it
  // cannot overwrite anything the user chose.
  'updateReminderSchema.actionMode',
];

const UPDATE_SCHEMAS: Array<{ name: string; schema: { safeParse: (v: unknown) => unknown } }> = [
  { name: 'updateReminderSchema', schema: updateReminderSchema },
  { name: 'updateTermSchema', schema: updateTermSchema },
  { name: 'updatePolicySchema', schema: updatePolicySchema },
  { name: 'updateClaimSchema', schema: updateClaimSchema },
  { name: 'updateVehicleSchema', schema: updateVehicleSchema },
];

/** Every `schema.key` an empty update injects, across all update schemas. */
function injectedKeys(): string[] {
  return UPDATE_SCHEMAS.flatMap(({ name, schema }) => {
    const result = schema.safeParse({}) as
      | { success: true; data: Record<string, unknown> }
      | { success: false };
    // Some update schemas .refine(keys > 0) so an empty update legitimately FAILS to parse — that
    // injects nothing, and the route rejects an empty body.
    if (!result.success) return [];
    return Object.keys(result.data).map((key) => `${name}.${key}`);
  });
}

ratchet({
  name: 'update schemas inject no clobbering default on an empty update',
  kind: 'exclusion',
  tolerated: EXEMPT_DEFAULT_KEYS,
  guidance:
    'These are injected on an empty update — a Zod .default() survived .partial() and would ' +
    'CLOBBER the stored value on any unrelated edit (the data-loss class). Re-declare the field ' +
    'as a plain .optional() with no default in the update schema via .extend(), or — if its value ' +
    'is a single literal that cannot clobber — add it to EXEMPT_DEFAULT_KEYS with a justification:',
  scan: injectedKeys,
  probe: () => {
    // Every schema must still PARSE or still refine-reject — if an import broke and safeParse threw
    // or every schema started refusing `{}`, the scan would be empty and pass forever.
    expect(UPDATE_SCHEMAS.length).toBe(5);
    const outcomes = UPDATE_SCHEMAS.map(
      ({ schema }) => schema.safeParse({}) as { success: boolean }
    );
    expect(outcomes.every((o) => typeof o.success === 'boolean')).toBe(true);
    // At least one schema accepts `{}`, which is the only case that can inject anything. Were that
    // to stop being true the guard would be vacuous rather than satisfied.
    expect(
      outcomes.some((o) => o.success),
      'no update schema accepts an empty object any more — this guard can no longer observe an injection'
    ).toBe(true);
  },
});
