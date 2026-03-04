/**
 * Property-Based Tests for Odometer Hooks
 *
 * Property 1: Expense hook invariant
 * For any sequence of expense create/update/delete operations with random mileage values,
 * the number of linked odometer entries equals the number of expenses with non-null mileage,
 * and each entry's odometer matches its source expense's mileage.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import type { Expense, OdometerEntry } from '../../../db/schema';

// ---------------------------------------------------------------------------
// Mutable state simulating the odometer entries in the database
// ---------------------------------------------------------------------------
let mockEntries: Map<string, OdometerEntry> = new Map();
let nextId = 1;

// Mock the repository module BEFORE importing hooks
mock.module('../repository', () => ({
  odometerRepository: {
    upsertFromLinkedEntity: async (params: {
      vehicleId: string;
      userId: string;
      odometer: number;
      recordedAt: Date;
      linkedEntityType: string;
      linkedEntityId: string;
    }): Promise<OdometerEntry> => {
      const existing = [...mockEntries.values()].find(
        (e) =>
          e.linkedEntityType === params.linkedEntityType &&
          e.linkedEntityId === params.linkedEntityId
      );
      if (existing) {
        const updated: OdometerEntry = {
          ...existing,
          odometer: params.odometer,
          recordedAt: params.recordedAt,
          updatedAt: new Date(),
        };
        mockEntries.set(existing.id, updated);
        return updated;
      }
      const id = `odo-${nextId++}`;
      const entry: OdometerEntry = {
        id,
        vehicleId: params.vehicleId,
        userId: params.userId,
        odometer: params.odometer,
        recordedAt: params.recordedAt,
        linkedEntityType: params.linkedEntityType,
        linkedEntityId: params.linkedEntityId,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockEntries.set(id, entry);
      return entry;
    },
    deleteByLinkedEntity: async (entityType: string, entityId: string): Promise<void> => {
      for (const [id, entry] of mockEntries) {
        if (entry.linkedEntityType === entityType && entry.linkedEntityId === entityId) {
          mockEntries.delete(id);
          break;
        }
      }
    },
    findByLinkedEntity: async (
      entityType: string,
      entityId: string
    ): Promise<OdometerEntry | null> => {
      return (
        [...mockEntries.values()].find(
          (e) => e.linkedEntityType === entityType && e.linkedEntityId === entityId
        ) ?? null
      );
    },
  },
}));

// Import hooks AFTER mocking
const {
  handleOdometerOnExpenseCreate,
  handleOdometerOnExpenseUpdate,
  handleOdometerOnExpenseDelete,
} = await import('../hooks');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExpense(id: string, vehicleId: string, mileage: number | null): Expense {
  return {
    id,
    vehicleId,
    category: 'fuel',
    tags: [],
    date: new Date('2024-06-15'),
    expenseAmount: 50,
    isFinancingPayment: false,
    mileage,
    description: null,
    receiptUrl: null,
    fuelAmount: null,
    fuelType: null,
    insurancePolicyId: null,
    insuranceTermId: null,
    missedFillup: false,
    expenseGroupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Operation types for the sequence generator
type Op =
  | { type: 'create'; expenseId: string; mileage: number | null }
  | { type: 'update'; expenseId: string; newMileage: number | null }
  | { type: 'delete'; expenseId: string };

// ---------------------------------------------------------------------------
// Property 1: Expense hook invariant
// ---------------------------------------------------------------------------
describe('Property 1: Expense hook invariant', () => {
  afterEach(() => {
    mockEntries = new Map();
    nextId = 1;
  });

  test('linked odometer entry count equals alive expenses with non-null mileage, and values match', async () => {
    // Generator for a sequence of expense operations
    const opSequenceArb = fc
      .array(
        fc.record({
          expenseIndex: fc.integer({ min: 0, max: 4 }),
          opType: fc.constantFrom('create', 'update', 'delete'),
          mileage: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 999999 })),
        }),
        { minLength: 1, maxLength: 30 }
      )
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: property-based test with inherent branching
      .map((rawOps) => {
        // Track which expenses exist to build valid operation sequences
        const created = new Set<string>();
        const ops: Op[] = [];

        for (const raw of rawOps) {
          const expenseId = `exp-${raw.expenseIndex}`;

          if (raw.opType === 'create' && !created.has(expenseId)) {
            ops.push({ type: 'create', expenseId, mileage: raw.mileage });
            created.add(expenseId);
          } else if (raw.opType === 'update' && created.has(expenseId)) {
            ops.push({ type: 'update', expenseId, newMileage: raw.mileage });
          } else if (raw.opType === 'delete' && created.has(expenseId)) {
            ops.push({ type: 'delete', expenseId });
            created.delete(expenseId);
          }
          // Skip invalid ops (e.g., update/delete on non-existent expense)
        }

        return ops;
      })
      .filter((ops) => ops.length > 0);

    await fc.assert(
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: property-based test with inherent branching
      fc.asyncProperty(opSequenceArb, async (ops) => {
        // Reset state for each run
        mockEntries = new Map();
        nextId = 1;

        // Track the "ground truth" state of expenses
        const aliveExpenses = new Map<string, { mileage: number | null }>();
        const vehicleId = 'v1';
        const userId = 'u1';

        for (const op of ops) {
          switch (op.type) {
            case 'create': {
              const expense = makeExpense(op.expenseId, vehicleId, op.mileage);
              aliveExpenses.set(op.expenseId, { mileage: op.mileage });
              await handleOdometerOnExpenseCreate(expense, userId);
              break;
            }
            case 'update': {
              const current = aliveExpenses.get(op.expenseId);
              if (!current) break;
              const existingExpense = makeExpense(op.expenseId, vehicleId, current.mileage);
              await handleOdometerOnExpenseUpdate(
                existingExpense,
                { mileage: op.newMileage },
                userId
              );
              aliveExpenses.set(op.expenseId, { mileage: op.newMileage });
              break;
            }
            case 'delete': {
              const current = aliveExpenses.get(op.expenseId);
              if (!current) break;
              const expense = makeExpense(op.expenseId, vehicleId, current.mileage);
              await handleOdometerOnExpenseDelete(expense);
              aliveExpenses.delete(op.expenseId);
              break;
            }
          }
        }

        // Invariant check: count of linked entries === count of alive expenses with non-null mileage
        const expensesWithMileage = [...aliveExpenses.entries()].filter(
          ([, v]) => v.mileage != null
        );
        const linkedEntries = [...mockEntries.values()].filter(
          (e) => e.linkedEntityType === 'expense'
        );

        expect(linkedEntries.length).toBe(expensesWithMileage.length);

        // Each alive expense with non-null mileage has exactly one matching entry
        for (const [expenseId, { mileage }] of expensesWithMileage) {
          const matching = linkedEntries.filter((e) => e.linkedEntityId === expenseId);
          expect(matching.length).toBe(1);
          expect(matching[0].odometer).toBe(mileage as number);
        }
      }),
      { numRuns: 200 }
    );
  });
});
