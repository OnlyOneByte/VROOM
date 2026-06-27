import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AppDatabase } from '../../db/connection';
import { getDb, transaction } from '../../db/connection';
import type { NewReminder, Reminder, ReminderNotification } from '../../db/schema';
import { reminderNotifications, reminders, reminderVehicles } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';
import { pruneVehicleFromSplitConfig } from './split-config-helpers';

// ============================================================================
// Types
// ============================================================================

export interface ReminderWithVehicles {
  reminder: Reminder;
  vehicleIds: string[];
}

export interface ReminderFilters {
  vehicleId?: string;
  type?: string;
  isActive?: boolean;
}

// ============================================================================
// Repository
// ============================================================================

export class ReminderRepository extends BaseRepository<Reminder, NewReminder> {
  constructor(db: AppDatabase) {
    super(db, reminders);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Fetch vehicleIds for a single reminder from the junction table.
   */
  private async getVehicleIds(reminderId: string): Promise<string[]> {
    const rows = await this.db
      .select({ vehicleId: reminderVehicles.vehicleId })
      .from(reminderVehicles)
      .where(eq(reminderVehicles.reminderId, reminderId));
    return rows.map((r) => r.vehicleId);
  }

  /**
   * Insert the reminder→vehicle junction rows inside the caller's transaction. One source of truth
   * for the `for (vehicleId) insert(reminderVehicles)` loop the create + update-replace paths repeated
   * byte-identically (C326 dedup; mirrors insurance/repository.ts insertJunctionRows). A future change
   * to the junction write (batch insert, a new column) then lands once, not twice.
   */
  private async insertVehicleJunctions(
    tx: DrizzleTransaction,
    reminderId: string,
    vehicleIds: string[]
  ): Promise<void> {
    for (const vehicleId of vehicleIds) {
      await tx.insert(reminderVehicles).values({ reminderId, vehicleId });
    }
  }

  /**
   * Batch-fetch vehicleIds for multiple reminders. Returns a map of reminderId → vehicleIds.
   */
  private async getVehicleIdsForReminders(reminderIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (reminderIds.length === 0) return map;

    const rows = await this.db
      .select({
        reminderId: reminderVehicles.reminderId,
        vehicleId: reminderVehicles.vehicleId,
      })
      .from(reminderVehicles)
      .where(inArray(reminderVehicles.reminderId, reminderIds));

    for (const row of rows) {
      const existing = map.get(row.reminderId) ?? [];
      existing.push(row.vehicleId);
      map.set(row.reminderId, existing);
    }

    return map;
  }

  /**
   * Attach vehicleIds to a list of reminders using a batch query.
   */
  private async attachVehicleIds(reminderList: Reminder[]): Promise<ReminderWithVehicles[]> {
    const ids = reminderList.map((r) => r.id);
    const vehicleMap = await this.getVehicleIdsForReminders(ids);
    return reminderList.map((reminder) => ({
      reminder,
      vehicleIds: vehicleMap.get(reminder.id) ?? [],
    }));
  }

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  /**
   * Find all reminders for a user with optional filters.
   * When vehicleId is provided, JOINs with reminder_vehicles to filter.
   */
  async findByUserId(userId: string, filters?: ReminderFilters): Promise<ReminderWithVehicles[]> {
    try {
      const conditions: SQL[] = [eq(reminders.userId, userId)];

      if (filters?.type) {
        conditions.push(eq(reminders.type, filters.type));
      }
      if (filters?.isActive !== undefined) {
        conditions.push(eq(reminders.isActive, filters.isActive));
      }

      let reminderList: Reminder[];

      if (filters?.vehicleId) {
        // JOIN with junction table to filter by vehicle
        const rows = await this.db
          .select({ reminder: reminders })
          .from(reminders)
          .innerJoin(reminderVehicles, eq(reminders.id, reminderVehicles.reminderId))
          .where(and(...conditions, eq(reminderVehicles.vehicleId, filters.vehicleId)));
        reminderList = rows.map((r) => r.reminder);
      } else {
        reminderList = await this.db
          .select()
          .from(reminders)
          .where(and(...conditions));
      }

      return this.attachVehicleIds(reminderList);
    } catch (error) {
      logger.error('Failed to find reminders for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find reminders for user', error);
    }
  }

  /**
   * Find a single reminder by ID scoped to a user, including vehicleIds.
   */
  async findByIdAndUserId(id: string, userId: string): Promise<ReminderWithVehicles | null> {
    const result = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .limit(1);

    const reminder = result[0];
    if (!reminder) return null;

    const vehicleIds = await this.getVehicleIds(id);
    return { reminder, vehicleIds };
  }

  /**
   * vehicle-sharing T7b: find a reminder by id UNSCOPED (no userId filter), with its vehicleIds. The
   * share-aware write routes (PUT/DELETE/mark-serviced) load the reminder this way FIRST — a reminder
   * on a shared vehicle is OWNER-stamped (userId = vehicle owner, T7b), so the old userId-scoped
   * findByIdAndUserId would 404 a shared editor on a reminder they can legitimately mutate. The caller
   * then authorizes via the share seam on the reminder's vehicleIds (requireVehicleWrite) and scopes
   * all subsequent repo reads/writes to the reminder's stamped userId (the owner). Returns null when
   * the reminder does not exist (caller → 404, existence-hiding).
   */
  async findByIdWithVehicles(id: string): Promise<ReminderWithVehicles | null> {
    const result = await this.db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
    const reminder = result[0];
    if (!reminder) return null;
    const vehicleIds = await this.getVehicleIds(id);
    return { reminder, vehicleIds };
  }

  /**
   * Find all overdue active reminders for a user (nextDueDate <= now).
   */
  async findOverdue(userId: string, now: Date): Promise<ReminderWithVehicles[]> {
    try {
      const reminderList = await this.db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            eq(reminders.isActive, true),
            lte(reminders.nextDueDate, now)
          )
        );

      return this.attachVehicleIds(reminderList);
    } catch (error) {
      logger.error('Failed to find overdue reminders', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find overdue reminders', error);
    }
  }

  /**
   * Find active mileage-tracking reminders for a user — `triggerMode` in ('mileage','both') with a
   * non-null `nextDueOdometer` milestone. Unlike findOverdue (the time axis), due-ness can't be
   * decided in SQL: it depends on the vehicle's CURRENT odometer (max across expenses + odometer
   * entries), which the trigger service fetches per vehicle. So this returns the candidate set; the
   * service evaluates `currentOdometer >= nextDueOdometer` against each.
   */
  async findMileageTracking(userId: string): Promise<ReminderWithVehicles[]> {
    try {
      const reminderList = await this.db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            eq(reminders.isActive, true),
            ne(reminders.triggerMode, 'time'),
            isNotNull(reminders.nextDueOdometer)
          )
        );

      return this.attachVehicleIds(reminderList);
    } catch (error) {
      logger.error('Failed to find mileage-tracking reminders', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find mileage-tracking reminders', error);
    }
  }

  /**
   * Whether a mileage notification already exists for this reminder + odometer milestone.
   * App-level guard for the mileage dedup (the C22 partial unique index
   * `(reminderId, dueOdometer) WHERE dueOdometer IS NOT NULL` is the DB backstop). A mileage axis
   * has no auto-re-arm — re-arm is the explicit mark-serviced path — so one notification per
   * milestone is correct, and re-running the trigger must be a no-op.
   */
  async mileageNotificationExists(reminderId: string, dueOdometer: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: reminderNotifications.id })
      .from(reminderNotifications)
      .where(
        and(
          eq(reminderNotifications.reminderId, reminderId),
          eq(reminderNotifications.dueOdometer, dueOdometer)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Insert a mileage-fired notification (null dueDate, dueOdometer set). Returns the created row,
   * or null if the partial unique index rejects a concurrent duplicate (idempotent under races).
   */
  async createMileageNotification(
    reminderId: string,
    userId: string,
    dueOdometer: number
  ): Promise<ReminderNotification | null> {
    try {
      const [created] = await this.db
        .insert(reminderNotifications)
        .values({ reminderId, userId, dueDate: null, dueOdometer, isRead: false })
        .returning();
      return created ?? null;
    } catch (error) {
      // Unique-index violation = another pass already wrote this milestone; treat as a no-op.
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw new DatabaseError('Failed to create mileage notification', error);
    }
  }

  // --------------------------------------------------------------------------
  // Mutation methods
  // --------------------------------------------------------------------------

  /**
   * Create a reminder with associated vehicle junction rows in a single transaction.
   * The caller supplies the final `nextDueDate` (= startDate for a time/both reminder, or null for a
   * pure-mileage reminder — T4) and any mileage fields; this method no longer overrides it.
   */
  async createWithVehicles(data: NewReminder, vehicleIds: string[]): Promise<ReminderWithVehicles> {
    try {
      return await transaction(async (tx) => {
        const result = await tx.insert(reminders).values(data).returning();
        const reminder = result[0];

        await this.insertVehicleJunctions(tx, reminder.id, vehicleIds);

        return { reminder, vehicleIds };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to create reminder with vehicles', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to create reminder with vehicles', error);
    }
  }

  /**
   * Update a reminder and optionally replace all junction rows in a single transaction.
   * When vehicleIds is provided, performs a full replacement of junction rows.
   */
  async updateWithVehicles(
    id: string,
    userId: string,
    data: Partial<NewReminder>,
    vehicleIds?: string[]
  ): Promise<ReminderWithVehicles> {
    try {
      return await transaction(async (tx) => {
        // Verify ownership
        const existing = await tx
          .select()
          .from(reminders)
          .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
          .limit(1);

        if (existing.length === 0) {
          throw new NotFoundError('Reminder');
        }

        // Update reminder fields
        const updateData = { ...data, updatedAt: new Date() };
        const result = await tx
          .update(reminders)
          .set(updateData)
          .where(eq(reminders.id, id))
          .returning();

        const reminder = result[0];

        // Replace junction rows if vehicleIds provided
        if (vehicleIds) {
          await tx.delete(reminderVehicles).where(eq(reminderVehicles.reminderId, id));
          await this.insertVehicleJunctions(tx, id, vehicleIds);
        }

        // Fetch current vehicleIds for the response
        const currentVehicleIds =
          vehicleIds ??
          (
            await tx
              .select({ vehicleId: reminderVehicles.vehicleId })
              .from(reminderVehicles)
              .where(eq(reminderVehicles.reminderId, id))
          ).map((r) => r.vehicleId);

        return { reminder, vehicleIds: currentVehicleIds };
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Failed to update reminder with vehicles', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to update reminder with vehicles', error);
    }
  }

  // --------------------------------------------------------------------------
  // Due date advancement (optimistic locking)
  // --------------------------------------------------------------------------

  /**
   * Advance nextDueDate with optimistic locking.
   * WHERE next_due_date = expectedCurrentDueDate prevents double-processing.
   */
  async advanceNextDueDate(
    id: string,
    expectedCurrentDueDate: Date,
    nextDueDate: Date
  ): Promise<void> {
    await this.db
      .update(reminders)
      .set({ nextDueDate, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.nextDueDate, expectedCurrentDueDate)));
  }

  /**
   * Transactional variant of advanceNextDueDate, also sets lastTriggeredAt.
   * Used by the trigger service within a transaction.
   */
  async advanceNextDueDateTx(
    tx: DrizzleTransaction,
    id: string,
    expectedCurrentDueDate: Date,
    nextDueDate: Date,
    lastTriggeredAt: Date
  ): Promise<void> {
    await tx
      .update(reminders)
      .set({ nextDueDate, lastTriggeredAt, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.nextDueDate, expectedCurrentDueDate)));
  }

  /**
   * Deactivate a reminder by setting isActive = false.
   */
  async deactivate(id: string): Promise<void> {
    await this.db
      .update(reminders)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(reminders.id, id));
  }

  /**
   * Deactivate any of the user's ACTIVE reminders that have NO remaining vehicles (#97, C40). When a
   * vehicle is deleted, its `reminder_vehicles` junction rows cascade away (schema onDelete:cascade), but
   * the reminder ROW survives — a reminder whose sole/last vehicle was the deleted one is left
   * `is_active=1` with zero vehicles, which the trigger then skips `no_vehicles` every run forever with no
   * user signal. Called after a vehicle delete: flip those to inactive so they leave the "active" surface
   * (and stop inflating the recurring-cost run-rate). Returns the count deactivated. Scoped by userId.
   */
  async deactivateVehicleless(userId: string): Promise<number> {
    // Active reminders for this user that have no junction row at all.
    const orphanRows = await this.db
      .select({ id: reminders.id })
      .from(reminders)
      .leftJoin(reminderVehicles, eq(reminders.id, reminderVehicles.reminderId))
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.isActive, true),
          isNull(reminderVehicles.reminderId)
        )
      );
    const ids = orphanRows.map((r) => r.id);
    if (ids.length === 0) return 0;
    await this.db
      .update(reminders)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(reminders.userId, userId), inArray(reminders.id, ids)));
    return ids.length;
  }

  /**
   * Prune a deleted vehicle from every reminder's `expenseSplitConfig` blob and renormalize (#88, C48).
   * Unlike the reminder_vehicles junction (FK onDelete:cascade), the split-config JSON is NOT FK-managed,
   * so a deleted vehicle's leg lingers in the blob — and on the next trigger `createExpenseFromReminder`
   * builds siblings from the blob's vehicleIds → an INSERT for the dead vehicleId → an FK violation that
   * (the C151 async-tx footgun) leaves the surviving legs partially committed. Call this BEFORE
   * `deactivateVehicleless` on a vehicle delete: each affected config is pruned via
   * `pruneVehicleFromSplitConfig` (drop the leg, rescale a percentage split, keep absolute amounts) when
   * ≥2 legs remain, else the blob is CLEARED to null so the reminder falls back to the single-vehicle
   * junction path (and deactivateVehicleless then catches a now-vehicleless reminder). Scoped by userId.
   * Returns the count of configs changed.
   */
  async pruneSplitConfigsForDeletedVehicle(
    userId: string,
    deletedVehicleId: string
  ): Promise<number> {
    // Only reminders that actually carry a split config can reference the deleted vehicle in their blob.
    const rows = await this.db
      .select({ id: reminders.id, expenseSplitConfig: reminders.expenseSplitConfig })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), isNotNull(reminders.expenseSplitConfig)));

    let changed = 0;
    for (const row of rows) {
      const config = row.expenseSplitConfig;
      if (!config) continue;
      const pruned = pruneVehicleFromSplitConfig(config, deletedVehicleId);
      // The helper returns the SAME reference when the deleted id wasn't in the config → skip the write.
      if (pruned === config) continue;
      await this.db
        .update(reminders)
        .set({ expenseSplitConfig: pruned, updatedAt: new Date() })
        .where(and(eq(reminders.id, row.id), eq(reminders.userId, userId)));
      changed++;
    }
    return changed;
  }

  /**
   * Apply a mark-serviced re-arm (D3) and return the updated row. The caller (route) has already
   * computed the new axis values from the reminder's mode: for the mileage axis the new
   * lastServiceOdometer (= current odometer) + nextDueOdometer; for the time axis the advanced
   * nextDueDate. Both are optional so a pure-mileage or pure-time reminder only moves its own axis.
   * `lastTriggeredAt` is stamped to now. Ownership-scoped (id + userId) so a cross-tenant id no-ops.
   */
  async markServiced(
    id: string,
    userId: string,
    fields: {
      lastServiceOdometer?: number;
      nextDueOdometer?: number;
      nextDueDate?: Date | null;
    }
  ): Promise<Reminder> {
    const result = await this.db
      .update(reminders)
      .set({ ...fields, lastTriggeredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .returning();
    const reminder = result[0];
    if (!reminder) throw new NotFoundError('Reminder');
    return reminder;
  }

  // --------------------------------------------------------------------------
  // Notification methods
  // --------------------------------------------------------------------------

  /**
   * Find notifications for a user, optionally filtered to unread only.
   */
  async findNotifications(userId: string, unreadOnly?: boolean): Promise<ReminderNotification[]> {
    try {
      const conditions: SQL[] = [eq(reminderNotifications.userId, userId)];

      if (unreadOnly) {
        conditions.push(eq(reminderNotifications.isRead, false));
      }

      return await this.db
        .select()
        .from(reminderNotifications)
        // Order by createdAt (the true recency axis spanning BOTH notification types), NOT dueDate.
        // A MILEAGE notification carries dueDate=NULL (its milestone lives in dueOdometer), and NULLs
        // sort LAST under `DESC` — so ordering by dueDate sank every mileage notification beneath every
        // time notification regardless of when it fired, and the limit(100) truncated the mileage axis
        // entirely for a user with ≥100 time notifications (a just-due service buried/invisible — #142,
        // feature-disabling for the maintenance-schedule mileage axis). createdAt is non-null on every
        // row ($defaultFn) and is the real "when it fired" order for the feed.
        .where(and(...conditions))
        .orderBy(desc(reminderNotifications.createdAt))
        .limit(CONFIG.validation.reminder.notificationsHistoryLimit);
    } catch (error) {
      logger.error('Failed to find notifications', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find notifications', error);
    }
  }

  /**
   * Mark a notification as read with ownership check.
   */
  async markNotificationRead(id: string, userId: string): Promise<void> {
    const result = await this.db
      .update(reminderNotifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(reminderNotifications.id, id), eq(reminderNotifications.userId, userId)))
      .returning();

    if (result.length === 0) {
      throw new NotFoundError('Notification');
    }
  }
}

// Export singleton instance
export const reminderRepository = new ReminderRepository(getDb());
