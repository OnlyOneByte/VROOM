import { expect } from 'bun:test';
import { ratchet } from '../../test-helpers/debt-ratchet';
import { updateClaimSchema } from '../insurance/claims-validation';
import { updatePolicySchema, updateTermSchema } from '../insurance/validation';
import { updateReminderSchema } from '../reminders/validation';
import { updateVehicleSchema } from '../vehicles/routes';

const EXEMPT_DEFAULT_KEYS = ['updateReminderSchema.actionMode'];

const UPDATE_SCHEMAS: Array<{ name: string; schema: { safeParse: (v: unknown) => unknown } }> = [
  { name: 'updateReminderSchema', schema: updateReminderSchema },
  { name: 'updateTermSchema', schema: updateTermSchema },
  { name: 'updatePolicySchema', schema: updatePolicySchema },
  { name: 'updateClaimSchema', schema: updateClaimSchema },
  { name: 'updateVehicleSchema', schema: updateVehicleSchema },
];

function injectedKeys(): string[] {
  return UPDATE_SCHEMAS.flatMap(({ name, schema }) => {
    const result = schema.safeParse({}) as
      | { success: true; data: Record<string, unknown> }
      | { success: false };
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
    expect(
      outcomes.some((o) => o.success),
      'no update schema accepts an empty object any more — this guard can no longer observe an injection'
    ).toBe(true);
  },
});
