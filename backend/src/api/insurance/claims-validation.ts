// The DB stores these as free text, so the allowed values are enforced here.

import { z } from 'zod';
import { CONFIG } from '../../config';
import { moneyDollarsToCents } from '../../utils/money';

const ins = CONFIG.validation.insurance;

export const CLAIM_TYPES = ['collision', 'theft', 'weather', 'vandalism', 'other'] as const;
export const CLAIM_STATUSES = ['filed', 'in_progress', 'settled', 'denied'] as const;
export const FAULT_DESIGNATIONS = ['at_fault', 'not_at_fault', 'shared'] as const;

export const createClaimSchema = z.object({
  claimDate: z.coerce.date(),
  claimType: z.enum(CLAIM_TYPES),
  description: z.string().max(ins.coverageDescriptionMaxLength).optional(),
  status: z.enum(CLAIM_STATUSES).optional().default('filed'),
  payoutAmount: moneyDollarsToCents((n) => n.min(0, 'Payout must be non-negative')).optional(),
  faultDesignation: z.enum(FAULT_DESIGNATIONS).optional(),
  // Must belong to the same policy; checked in the route.
  termId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
});

export const updateClaimSchema = z
  .object({
    claimDate: z.coerce.date().optional(),
    claimType: z.enum(CLAIM_TYPES).optional(),
    // Nullish, so an explicit null clears the column. JSON.stringify drops undefined,
    // so null is the only clear signal.
    description: z.string().max(ins.coverageDescriptionMaxLength).nullish(),
    status: z.enum(CLAIM_STATUSES).optional(),
    payoutAmount: moneyDollarsToCents((n) => n.min(0, 'Payout must be non-negative')).nullish(),
    faultDesignation: z.enum(FAULT_DESIGNATIONS).nullish(),
    termId: z.string().min(1).nullish(),
    vehicleId: z.string().min(1).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required to update',
  });
