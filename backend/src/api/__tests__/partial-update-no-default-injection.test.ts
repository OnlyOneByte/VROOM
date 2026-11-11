/**
 * Guards against `.default()` surviving `.partial()`. The default would be injected into any update
 * that omits the field and would overwrite the stored value. The test parses an empty update against
 * each update schema and fails on any injected key that is not on the allowlist.
 */

import { expect } from 'bun:test';
import { ratchet } from '../../test-helpers/debt-ratchet';
import { updateClaimSchema } from '../insurance/claims-validation';
import { updatePolicySchema, updateTermSchema } from '../insurance/validation';
import { updateReminderSchema } from '../reminders/validation';
import { updateVehicleSchema } from '../vehicles/routes';

// Qualified by schema name so an exemption cannot leak to another schema. Only fields with exactly
// one legal value belong here, since re-injecting that value cannot overwrite a user choice.
const EXEMPT_DEFAULT_KEYS = [
  // z.literal('automatic').default('automatic')
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
    // A schema that refuses an empty update injects nothing.
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
    expect(UPDATE_SCHEMAS.length).toBe(5);
    const outcomes = UPDATE_SCHEMAS.map(
      ({ schema }) => schema.safeParse({}) as { success: boolean }
    );
    expect(outcomes.every((o) => typeof o.success === 'boolean')).toBe(true);
    // Without a schema that accepts `{}`, the scan could never observe an injection.
    expect(
      outcomes.some((o) => o.success),
      'no update schema accepts an empty object any more — this guard can no longer observe an injection'
    ).toBe(true);
  },
});
