import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { Expense, ExpenseGroup, NewExpense, SplitConfig } from '../../db/schema';
import { expenseGroups, expenses } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';

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
   * Delete existing children and create new ones from split config.
   * Runs inside the caller's transaction.
   */
  async materializeChildren(tx: DrizzleTransaction, group: ExpenseGroup): Promise<Expense[]> {
    // 1. Delete existing children for this group
    await tx.delete(expenses).where(eq(expenses.expenseGroupId, group.id));

    // 2. Compute per-vehicle allocations
    const allocations = this.computeAllocations(group.splitConfig, group.totalAmount);

    // 3. Insert a child expense per allocation
    const childExpenses: Expense[] = [];
    for (const allocation of allocations) {
      const newExpense: NewExpense = {
        id: createId(),
        vehicleId: allocation.vehicleId,
        expenseAmount: allocation.amount,
        expenseGroupId: group.id,
        category: group.category,
        date: group.date,
        tags: group.tags,
        description: group.description,
        insurancePolicyId: group.insurancePolicyId,
        insuranceTermId: group.insuranceTermId,
        isFinancingPayment: false,
        missedFillup: false,
      };

      const [inserted] = await tx.insert(expenses).values(newExpense).returning();
      childExpenses.push(inserted);
    }

    return childExpenses;
  }
  /**
   * Update an expense group's split config and regenerate children.
   */
  async updateSplit(
    tx: DrizzleTransaction,
    groupId: string,
    newConfig: SplitConfig,
    newTotalAmount?: number
  ): Promise<{ group: ExpenseGroup; children: Expense[] }> {
    // 1. Build the update payload
    const updateData: Partial<ExpenseGroup> = {
      splitConfig: newConfig,
      updatedAt: new Date(),
    };
    if (newTotalAmount !== undefined) {
      updateData.totalAmount = newTotalAmount;
    }

    // 2. Update the expense group row
    const [updatedGroup] = await tx
      .update(expenseGroups)
      .set(updateData)
      .where(eq(expenseGroups.id, groupId))
      .returning();

    // 3. Regenerate children (deletes old + inserts new)
    const children = await this.materializeChildren(tx, updatedGroup);

    return { group: updatedGroup, children };
  }
}

export const expenseSplitService = new ExpenseSplitService();
