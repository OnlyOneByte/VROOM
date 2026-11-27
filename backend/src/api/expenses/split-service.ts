import { createId } from '@paralleldrive/cuid2';
import { and, eq, inArray } from 'drizzle-orm';
import type { AsyncHandle } from '../../db/async-sqlite';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses, photos } from '../../db/schema';
import { percentageToBasisPoints, type SplitConfig } from './validation';

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
    let cumulativePercentage = 0;
    const lastIndex = allocations.length - 1;

    for (let i = 0; i < allocations.length; i++) {
      const { vehicleId, percentage } = allocations[i];
      cumulativePercentage += percentage;
      const cumulativeCents =
        i === lastIndex
          ? totalCents
          : Math.floor((totalCents * percentageToBasisPoints(cumulativePercentage)) / 10_000);
      const amount = Math.max(0, cumulativeCents - runningTotal);

      runningTotal += amount;
      result.push({ vehicleId, amount });
    }

    return result;
  }

  async createSiblings(
    tx: AsyncHandle,
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
      payerFor?: (vehicleId: string) => string | null;
      updatedAt?: Date;
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
        paidByDriverId: params.payerFor?.(allocation.vehicleId) ?? null,
        ...(params.updatedAt ? { updatedAt: params.updatedAt } : {}),
      };

      const [inserted] = await tx.insert(expenses).values(newExpense).returning();
      if (!inserted) throw new Error('Expense insert returned no row');
      siblings.push(inserted);
    }

    return siblings;
  }

  async updateSiblings(
    tx: AsyncHandle,
    params: {
      groupId: string;
      existing: [Expense, ...Expense[]];
      splitMethod: SplitMethod;
      groupTotal: number;
      allocations: Array<{ vehicleId: string; amount: number }>;
      createdBy: string | null;
      updatedAt: Date;
    }
  ): Promise<Expense[]> {
    const [template] = params.existing;
    const unmatchedByVehicle = new Map<string, Expense[]>();
    for (const leg of params.existing) {
      const legs = unmatchedByVehicle.get(leg.vehicleId) ?? [];
      legs.push(leg);
      unmatchedByVehicle.set(leg.vehicleId, legs);
    }

    const groupLegs = (ids: string[]) =>
      and(
        inArray(expenses.id, ids),
        eq(expenses.groupId, params.groupId),
        eq(expenses.userId, template.userId)
      );
    const { updatedAt } = params;
    const legs: Expense[] = [];
    for (const allocation of params.allocations) {
      const match = unmatchedByVehicle.get(allocation.vehicleId)?.shift();
      if (!match) {
        const created = await this.createSiblings(tx, {
          groupId: params.groupId,
          userId: template.userId,
          createdBy: params.createdBy,
          splitMethod: params.splitMethod,
          groupTotal: params.groupTotal,
          allocations: [allocation],
          category: template.category,
          date: template.date,
          tags: template.tags ?? undefined,
          description: template.description ?? undefined,
          sourceType: template.sourceType ?? undefined,
          sourceId: template.sourceId ?? undefined,
          updatedAt,
        });
        legs.push(...created);
        continue;
      }
      const updated = await tx
        .update(expenses)
        .set({
          expenseAmount: allocation.amount,
          groupTotal: params.groupTotal,
          splitMethod: params.splitMethod,
          updatedAt,
        })
        .where(groupLegs([match.id]))
        .returning();
      legs.push(...updated);
    }

    const removedIds = [...unmatchedByVehicle.values()].flat().map((leg) => leg.id);
    const [survivor] = legs;
    if (removedIds.length > 0 && survivor) {
      await tx
        .update(photos)
        .set({ entityId: survivor.id })
        .where(and(eq(photos.entityType, 'expense'), inArray(photos.entityId, removedIds)));
      await tx.delete(expenses).where(groupLegs(removedIds));
    }

    return legs;
  }
}

export const expenseSplitService = new ExpenseSplitService();
