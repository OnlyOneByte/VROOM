/**
 * Insurance Validation Schemas
 *
 * Zod schemas for insurance policy and term validation.
 * Uses CONFIG validation constants for max lengths.
 */

import { z } from 'zod';
import { CONFIG } from '../../config';

const ins = CONFIG.validation.insurance;

// --- Nested detail schemas ---

export const policyDetailsSchema = z
  .object({
    policyNumber: z.string().max(ins.policyNumberMaxLength).optional(),
    coverageDescription: z.string().max(ins.coverageDescriptionMaxLength).optional(),
    deductibleAmount: z.number().positive('Deductible must be positive').optional(),
    coverageLimit: z.number().positive('Coverage limit must be positive').optional(),
    agentName: z.string().max(ins.agentNameMaxLength).optional(),
    agentPhone: z.string().max(ins.agentPhoneMaxLength).optional(),
    agentEmail: z.string().email().max(ins.agentEmailMaxLength).optional(),
  })
  .optional()
  .default({});

export const financeDetailsSchema = z
  .object({
    totalCost: z.number().min(0, 'Total cost must be non-negative').optional(),
    monthlyCost: z.number().min(0, 'Monthly cost must be non-negative').optional(),
    premiumFrequency: z.string().max(ins.premiumFrequencyMaxLength).optional(),
    paymentAmount: z.number().min(0, 'Payment amount must be non-negative').optional(),
  })
  .optional()
  .default({});

// --- Term vehicle coverage schema ---

export const termVehicleCoverageSchema = z.object({
  vehicleIds: z.array(z.string().min(1)).min(1, 'At least one vehicle required'),
  splitMethod: z.enum(['even', 'absolute', 'percentage']).optional().default('even'),
  allocations: z
    .array(
      z.object({
        vehicleId: z.string().min(1),
        amount: z.number().min(0).optional(),
        percentage: z.number().min(0).max(100).optional(),
      })
    )
    .optional(),
});

// --- Term schemas ---

export const policyTermSchema = z
  .object({
    id: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    policyDetails: policyDetailsSchema,
    financeDetails: financeDetailsSchema,
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
  });

const createPolicyTermSchema = z
  .object({
    id: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    policyDetails: policyDetailsSchema,
    financeDetails: financeDetailsSchema,
    vehicleCoverage: termVehicleCoverageSchema,
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
  });

// --- Policy CRUD schemas ---

export const createPolicySchema = z.object({
  company: z.string().min(1, 'Company is required').max(ins.companyMaxLength),
  terms: z.array(createPolicyTermSchema).min(1, 'At least one term is required'),
  notes: z.string().max(ins.notesMaxLength).optional(),
  isActive: z.boolean().optional().default(true),
});

export const updatePolicySchema = z.object({
  company: z.string().min(1, 'Company is required').max(ins.companyMaxLength).optional(),
  notes: z.string().max(ins.notesMaxLength).optional(),
  isActive: z.boolean().optional(),
});

export const addTermSchema = createPolicyTermSchema;

export const updateTermSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    policyDetails: policyDetailsSchema,
    financeDetails: financeDetailsSchema,
    vehicleCoverage: termVehicleCoverageSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate > data.startDate;
      }
      return true;
    },
    { message: 'End date must be after start date' }
  );
