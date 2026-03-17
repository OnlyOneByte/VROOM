import { createId } from '@paralleldrive/cuid2';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import type { SplitConfig } from './validation';

export class ExpenseSplitService {
  /**
   * Compute per-vehicle amounts from a split config and total.
   * Pure function — no DB access.
   */
  computeAllocations(
    config: SplitConfig,
    totalAmount: number
  ): Array<{ vehicleId: string; amount: number }> {
    switch (config.method) {
      case 'even':
        return this.computeEvenSplit(config.vehicleIds, totalAmount);
      case 'absolute':
        return config.allocations.map((a) => ({
          vehicleId: a.vehicleId,
          amount: a.amount,
        }));
      case 'percentage':
        return this.computePercentageSplit(config.allocations, totalAmount);
    }
  }

  private computeEvenSplit(
    vehicleIds: string[],
    totalAmount: number
  ): Array<{ vehicleId: string; amount: number }> {
    const n = vehicleIds.length;
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / n);
    const remainderCents = totalCents - baseCents * n;

    return vehicleIds.map((vehicleId, i) => ({
      vehicleId,
      amount: (baseCents + (i < remainderCents ? 1 : 0)) / 100,
    }));
  }

  private computePercentageSplit(
    allocations: Array<{ vehicleId: string; percentage: number }>,
    totalAmount: number
  ): Array<{ vehicleId: string; amount: number }> {
    const result: Array<{ vehicleId: string; amount: number }> = [];
    let runningTotal = 0;
    const lastIndex = allocations.length - 1;

    for (let i = 0; i < allocations.length; i++) {
      const { vehicleId, percentage } = allocations[i];
      let amount: number;

      if (i === lastIndex) {
        // Assign remainder to last vehicle, clamped to zero to prevent negative amounts from rounding
        amount = Math.max(0, Math.round((totalAmount - runningTotal) * 100) / 100);
      } else {
        amount = Math.floor(((totalAmount * percentage) / 100) * 100) / 100;
      }

      runningTotal += amount;
      result.push({ vehicleId, amount });
    }

    return result;
  }

  /**
   * Insert sibling expense rows sharing the same groupId.
   * Runs inside the caller's transaction.
   */
  async createSiblings(
    tx: DrizzleTransaction,
    params: {
      groupId: string;
      userId: string;
      splitMethod: SplitMethod;
      groupTotal: number;
      allocations: Array<{ vehicleId: string; amount: number }>;
      category: string;
      date: Date;
      tags?: string[];
      description?: string;
      sourceType?: string;
      sourceId?: string;
    }
  ): Promise<Expense[]> {
    const siblings: Expense[] = [];

    for (const allocation of params.allocations) {
      const newExpense: NewExpense = {
        id: createId(),
        vehicleId: allocation.vehicleId,
        expenseAmount: allocation.amount,
        userId: params.userId,
        groupId: params.groupId,
        groupTotal: params.groupTotal,
        splitMethod: params.splitMethod,
        category: params.category,
        date: params.date,
        tags: params.tags ?? null,
        description: params.description ?? null,
        missedFillup: false,
        sourceType: params.sourceType ?? null,
        sourceId: params.sourceId ?? null,
      };

      const [inserted] = await tx.insert(expenses).values(newExpense).returning();
      siblings.push(inserted);
    }

    return siblings;
  }
}

export const expenseSplitService = new ExpenseSplitService();
