/**
 * Backup Validator - Validates backup data structure and content
 */

import { z } from 'zod';
import { BACKUP_CONFIG } from '../../constants/backup';
import { logger } from '../../utils/logger';
import type { ParsedBackupData } from './types';

// Zod schemas for runtime validation
const vehicleSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 2),
  vehicleType: z.string().optional(),
  licensePlate: z.string().optional(),
  nickname: z.string().optional(),
  initialMileage: z.coerce.number().optional(),
  purchasePrice: z.coerce.number().optional(),
  purchaseDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  updatedAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
});

const expenseSchema = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1),
  category: z.string().min(1),
  tags: z.string().optional(),
  amount: z.coerce.number(),
  currency: z.string().min(1),
  date: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  mileage: z.coerce.number().optional(),
  volume: z.coerce.number().optional(),
  charge: z.coerce.number().optional(),
  description: z.string().optional(),
  receiptUrl: z.string().optional(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  updatedAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
});

const financingSchema = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1),
  financingType: z.string().min(1),
  provider: z.string().optional(),
  originalAmount: z.coerce.number(),
  currentBalance: z.coerce.number().optional(),
  apr: z.coerce.number().optional(),
  termMonths: z.coerce.number().int().optional(),
  startDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  paymentAmount: z.coerce.number().optional(),
  paymentFrequency: z.string().optional(),
  paymentDayOfMonth: z.coerce.number().int().optional(),
  paymentDayOfWeek: z.coerce.number().int().optional(),
  residualValue: z.coerce.number().optional(),
  mileageLimit: z.coerce.number().optional(),
  excessMileageFee: z.coerce.number().optional(),
  isActive: z.coerce.boolean().optional(),
  endDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  updatedAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
});

const financingPaymentSchema = z.object({
  id: z.string().min(1),
  financingId: z.string().min(1),
  paymentDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  paymentAmount: z.coerce.number(),
  principalAmount: z.coerce.number().optional(),
  interestAmount: z.coerce.number().optional(),
  remainingBalance: z.coerce.number().optional(),
  paymentNumber: z.coerce.number().int().optional(),
  paymentType: z.string().optional(),
  isScheduled: z.coerce.boolean().optional(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  updatedAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
});

const insuranceSchema = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1),
  company: z.string().min(1),
  policyNumber: z.string().optional(),
  totalCost: z.coerce.number(),
  termLengthMonths: z.coerce.number().int().optional(),
  startDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  endDate: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  monthlyCost: z.coerce.number().optional(),
  isActive: z.coerce.boolean().optional(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
  updatedAt: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .optional(),
});

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class BackupValidator {
  /**
   * Validate backup data structure and content
   */
  validateBackupData(backup: ParsedBackupData): ValidationResult {
    const errors: string[] = [];

    // Validate metadata
    if (!backup.metadata || !backup.metadata.userId || !backup.metadata.version) {
      errors.push('Invalid metadata: missing userId or version');
    }

    // Validate version
    if (backup.metadata.version !== BACKUP_CONFIG.CURRENT_VERSION) {
      errors.push(
        `Version mismatch: expected ${BACKUP_CONFIG.CURRENT_VERSION}, got ${backup.metadata.version}`
      );
    }

    // Validate vehicles
    const vehicleErrors = this.validateArray(backup.vehicles, vehicleSchema, 'vehicles');
    errors.push(...vehicleErrors);

    // Validate expenses
    const expenseErrors = this.validateArray(backup.expenses, expenseSchema, 'expenses');
    errors.push(...expenseErrors);

    // Validate financing
    const financingErrors = this.validateArray(backup.financing, financingSchema, 'financing');
    errors.push(...financingErrors);

    // Validate financing payments
    const paymentErrors = this.validateArray(
      backup.financingPayments,
      financingPaymentSchema,
      'financingPayments'
    );
    errors.push(...paymentErrors);

    // Validate insurance
    const insuranceErrors = this.validateArray(backup.insurance, insuranceSchema, 'insurance');
    errors.push(...insuranceErrors);

    // Validate referential integrity
    const integrityErrors = this.validateReferentialIntegrity(backup);
    errors.push(...integrityErrors);

    if (errors.length > 0) {
      logger.warn('Backup validation failed', { errorCount: errors.length, errors });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate an array of records against a schema
   */
  private validateArray(
    records: Record<string, unknown>[],
    // biome-ignore lint/suspicious/noExplicitAny: Zod schema type is complex and requires any
    schema: z.ZodObject<any>,
    tableName: string
  ): string[] {
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const result = schema.safeParse(records[i]);
      if (!result.success) {
        const fieldErrors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        errors.push(`${tableName}[${i}]: ${fieldErrors.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Validate referential integrity between tables
   */
  private validateReferentialIntegrity(backup: ParsedBackupData): string[] {
    const errors: string[] = [];

    const vehicleIds = new Set(backup.vehicles.map((v) => String(v.id)));
    const financingIds = new Set(backup.financing.map((f) => String(f.id)));

    // Check expenses reference valid vehicles
    for (const expense of backup.expenses) {
      if (!vehicleIds.has(String(expense.vehicleId))) {
        errors.push(`Expense ${expense.id} references non-existent vehicle ${expense.vehicleId}`);
      }
    }

    // Check financing references valid vehicles
    for (const financing of backup.financing) {
      if (!vehicleIds.has(String(financing.vehicleId))) {
        errors.push(
          `Financing ${financing.id} references non-existent vehicle ${financing.vehicleId}`
        );
      }
    }

    // Check financing payments reference valid financing
    for (const payment of backup.financingPayments) {
      if (!financingIds.has(String(payment.financingId))) {
        errors.push(
          `Payment ${payment.id} references non-existent financing ${payment.financingId}`
        );
      }
    }

    // Check insurance references valid vehicles
    for (const insurance of backup.insurance) {
      if (!vehicleIds.has(String(insurance.vehicleId))) {
        errors.push(
          `Insurance ${insurance.id} references non-existent vehicle ${insurance.vehicleId}`
        );
      }
    }

    return errors;
  }

  /**
   * Validate file size
   */
  validateFileSize(size: number): ValidationResult {
    if (size > BACKUP_CONFIG.MAX_FILE_SIZE) {
      return {
        valid: false,
        errors: [
          `File size ${size} bytes exceeds maximum allowed size of ${BACKUP_CONFIG.MAX_FILE_SIZE} bytes`,
        ],
      };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Validate user ID matches
   */
  validateUserId(backupUserId: string, requestUserId: string): ValidationResult {
    if (backupUserId !== requestUserId) {
      return {
        valid: false,
        errors: ['Backup file belongs to a different user'],
      };
    }

    return { valid: true, errors: [] };
  }
}

export const backupValidator = new BackupValidator();
