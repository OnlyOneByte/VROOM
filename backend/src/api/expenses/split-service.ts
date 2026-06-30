import { createId } from '@paralleldrive/cuid2';
import type { Expense, NewExpense, SplitMethod } from '../../db/schema';
import { expenses } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import type { SplitConfig } from './validation';

export class ExpenseSplitService {
  /**
   * Compute per-vehicle amounts (integer CENTS) from a split config and total.
   * `totalAmount` is integer CENTS (money-cents-migration T5 — the input edge already converted
   * dollars→cents); allocation amounts in an `absolute` config are likewise cents. Pure — no DB.
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
    totalCents: number
  ): Array<{ vehicleId: string; amount: number }> {
    // money-cents-migration (T5): `totalCents` arrives as integer CENTS (the input edge already
    // converted dollars→cents), so this is now NATIVE integer arithmetic — no `*100` in, no `/100` out.
    // The largest-remainder distribution (baseCents + 1 for the first `remainderCents` legs) was already
    // the cents-correct algorithm; it now operates directly on the stored unit, so Σlegs == totalCents EXACTLY.
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
    // money-cents-migration (T5): `totalCents` is integer CENTS. Each leg is `floor(totalCents *
    // percentage / 100)` — `percentage` is a non-money ratio, so the result is cents — and the LAST leg
    // takes the exact integer remainder so Σlegs == totalCents EXACTLY (no float remainder, no `/100`).
    const result: Array<{ vehicleId: string; amount: number }> = [];
    let runningTotal = 0;
    const lastIndex = allocations.length - 1;

    for (let i = 0; i < allocations.length; i++) {
      const { vehicleId, percentage } = allocations[i];
      let amount: number;

      if (i === lastIndex) {
        // Assign the exact remaining cents to the last vehicle, clamped to ≥ 0.
        amount = Math.max(0, totalCents - runningTotal);
      } else {
        amount = Math.floor((totalCents * percentage) / 100);
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
      // vehicle-sharing T5b-2b: provenance of a shared-editor-created split (design §2.1 rule 2).
      // `userId` is the vehicle OWNER (owner-stamp); `createdBy` records the actual author — the
      // acting editor when they are not the owner, else NULL (the legacy/self sentinel). Omitted ⇒
      // NULL, so an owner-authored split is byte-identical to pre-T5b-2b.
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

  /**
   * SYNCHRONOUS sibling of createSiblings (#127 class, C504). bun-sqlite is a sync dialect, so the split
   * create/update transactions run their callbacks synchronously for real atomic rollback — an async
   * callback autocommits each insert alone (the C151 footgun), which on the update path (delete-then-
   * reinsert) could irrecoverably lose a split group. `.returning().get()` executes inline inside the
   * caller's tx. Identical row shape to createSiblings — the two MUST stay in lockstep.
   */
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
