/**
 * Insurance Claims Validation Schemas
 *
 * The DB stores claimType / status / faultDesignation as free-text columns; the
 * allowed values are enforced here at the zod layer (same approach as
 * insurance_terms.premiumFrequency).
 */

import { z } from 'zod';
import { CONFIG } from '../../config';

const ins = CONFIG.validation.insurance;

export const CLAIM_TYPES = ['collision', 'theft', 'weather', 'vandalism', 'other'] as const;
export const CLAIM_STATUSES = ['filed', 'in_progress', 'settled', 'denied'] as const;
export const FAULT_DESIGNATIONS = ['at_fault', 'not_at_fault', 'shared'] as const;

export const createClaimSchema = z.object({
  claimDate: z.coerce.date(),
  claimType: z.enum(CLAIM_TYPES),
  description: z.string().max(ins.coverageDescriptionMaxLength).optional(),
  status: z.enum(CLAIM_STATUSES).optional().default('filed'),
  payoutAmount: z.number().min(0, 'Payout must be non-negative').optional(),
  faultDesignation: z.enum(FAULT_DESIGNATIONS).optional(),
  // Optional links to a specific term / vehicle on the same policy.
  termId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
});

export const updateClaimSchema = z
  .object({
    claimDate: z.coerce.date().optional(),
    claimType: z.enum(CLAIM_TYPES).optional(),
    // Optional value fields are nullish on UPDATE: an explicit `null` clears the
    // column (the user emptied the field in the form). `undefined`/absent leaves
    // it unchanged. This matters because JSON.stringify drops `undefined`, so the
    // only way the client can signal "clear this" is to send `null`.
    description: z.string().max(ins.coverageDescriptionMaxLength).nullish(),
    status: z.enum(CLAIM_STATUSES).optional(),
    payoutAmount: z.number().min(0, 'Payout must be non-negative').nullish(),
    faultDesignation: z.enum(FAULT_DESIGNATIONS).nullish(),
    termId: z.string().min(1).nullish(),
    vehicleId: z.string().min(1).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required to update',
  });
