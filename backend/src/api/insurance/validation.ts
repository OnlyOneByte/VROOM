import { z } from 'zod';
import { CONFIG } from '../../config';
import { moneyDollarsToCents } from '../../utils/money';

const ins = CONFIG.validation.insurance;

export const termVehicleCoverageSchema = z.object({
  vehicleIds: z.array(z.string().min(1)).min(1, 'At least one vehicle required'),
});

const baseTermFields = {
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  policyNumber: z.string().max(ins.policyNumberMaxLength).optional(),
  coverageDescription: z.string().max(ins.coverageDescriptionMaxLength).optional(),
  deductibleAmount: moneyDollarsToCents((n) =>
    n.positive('Deductible must be positive')
  ).optional(),
  coverageLimit: moneyDollarsToCents((n) =>
    n.positive('Coverage limit must be positive')
  ).optional(),
  agentName: z.string().max(ins.agentNameMaxLength).optional(),
  agentPhone: z.string().max(ins.agentPhoneMaxLength).optional(),
  agentEmail: z.string().email().max(ins.agentEmailMaxLength).optional(),
  totalCost: moneyDollarsToCents((n) => n.min(0, 'Total cost must be non-negative')).optional(),
  monthlyCost: moneyDollarsToCents((n) => n.min(0, 'Monthly cost must be non-negative')).optional(),
  premiumFrequency: z.string().max(ins.premiumFrequencyMaxLength).optional(),
  paymentAmount: moneyDollarsToCents((n) =>
    n.min(0, 'Payment amount must be non-negative')
  ).optional(),
};

export const createTermSchema = z
  .object({
    ...baseTermFields,
    vehicleCoverage: termVehicleCoverageSchema,
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
  });

export const updateTermSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    policyNumber: z.string().max(ins.policyNumberMaxLength).nullish(),
    coverageDescription: z.string().max(ins.coverageDescriptionMaxLength).nullish(),
    deductibleAmount: moneyDollarsToCents((n) =>
      n.positive('Deductible must be positive')
    ).nullish(),
    coverageLimit: moneyDollarsToCents((n) =>
      n.positive('Coverage limit must be positive')
    ).nullish(),
    agentName: z.string().max(ins.agentNameMaxLength).nullish(),
    agentPhone: z.string().max(ins.agentPhoneMaxLength).nullish(),
    agentEmail: z.string().email().max(ins.agentEmailMaxLength).nullish(),
    totalCost: moneyDollarsToCents((n) => n.min(0, 'Total cost must be non-negative')).nullish(),
    monthlyCost: moneyDollarsToCents((n) =>
      n.min(0, 'Monthly cost must be non-negative')
    ).nullish(),
    premiumFrequency: z.string().max(ins.premiumFrequencyMaxLength).nullish(),
    paymentAmount: moneyDollarsToCents((n) =>
      n.min(0, 'Payment amount must be non-negative')
    ).nullish(),
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

export const createPolicySchema = z.object({
  company: z.string().min(1, 'Company is required').max(ins.companyMaxLength),
  terms: z.array(createTermSchema).min(1, 'At least one term is required'),
  notes: z.string().max(ins.notesMaxLength).optional(),
  isActive: z.boolean().optional().default(true),
});

export const updatePolicySchema = z.object({
  company: z.string().min(1, 'Company is required').max(ins.companyMaxLength).optional(),
  notes: z.string().max(ins.notesMaxLength).nullish(),
  isActive: z.boolean().optional(),
});

export const addTermSchema = createTermSchema;
