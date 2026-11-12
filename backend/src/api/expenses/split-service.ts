import { createId } from '@paralleldrive/cuid2';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import type { SplitConfig } from './validation';

export class ExpenseSplitService {
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
    totalCents: number
  ): Array<{ vehicleId: string; amount: number }> {
    const n = vehicleIds.length;
    const baseCents = Math.floor(totalCents / n);
    const remainderCents = totalCents - baseCents * n;

    return vehicleIds.map((vehicleId, i) => ({
      vehicleId,
      amount: baseCents + (i < remainderCents ? 1 : 0),
    }));
  }

  private computePercentageSplit(
    allocations: Array<{ vehicleId: string; percentage: number }>,
    totalCents: number
  ): Array<{ vehicleId: string; amount: number }> {
    const result: Array<{ vehicleId: string; amount: number }> = [];
    let runningTotal = 0;
    const lastIndex = allocations.length - 1;

    for (let i = 0; i < allocations.length; i++) {
      const { vehicleId, percentage } = allocations[i];
      let amount: number;

      if (i === lastIndex) {
        amount = Math.max(0, totalCents - runningTotal);
      } else {
        amount = Math.floor((totalCents * percentage) / 100);
      }

      runningTotal += amount;
      result.push({ vehicleId, amount });
    }

    return result;
  }

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
      createdBy?: string | null;
    }
  ): Promise<Expense[]> {
    const siblings: Expense[] = [];

    for (const allocation of params.allocations) {
      const newExpense: NewExpense = {
        id: createId(),
        vehicleId: allocation.vehicleId,
        expenseAmount: allocation.amount,
        userId: params.userId,
        createdBy: params.createdBy ?? null,
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

  // bun:sqlite transactions roll back only when the callback is synchronous; an async insert autocommits alone.
  createSiblingsSync(
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
      createdBy?: string | null;
    }
  ): Expense[] {
    const siblings: Expense[] = [];

    for (const allocation of params.allocations) {
      const newExpense: NewExpense = {
        id: createId(),
        vehicleId: allocation.vehicleId,
        expenseAmount: allocation.amount,
        userId: params.userId,
        createdBy: params.createdBy ?? null,
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

      const inserted = tx.insert(expenses).values(newExpense).returning().get();
      siblings.push(inserted);
    }

    return siblings;
  }
}

export const expenseSplitService = new ExpenseSplitService();
