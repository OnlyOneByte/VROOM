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

export interface ReminderWithVehicles {
  reminder: Reminder;
  vehicleIds: string[];
}

export interface ReminderFilters {
  vehicleId?: string;
  type?: string;
  isActive?: boolean;
}

export class ReminderRepository extends BaseRepository<Reminder, NewReminder> {
  constructor(db: AppDatabase) {
    super(db, reminders);
  }

  private async getVehicleIds(reminderId: string): Promise<string[]> {
    const rows = await this.db
      .select({ vehicleId: reminderVehicles.vehicleId })
      .from(reminderVehicles)
      .where(eq(reminderVehicles.reminderId, reminderId));
    return rows.map((r) => r.vehicleId);
  }

  /**
   * Must stay synchronous: an async transaction callback under bun-sqlite autocommits each write on its
   * own, which could leave a reminder with no vehicles.
   */
  private insertVehicleJunctionsSync(
    tx: DrizzleTransaction,
    reminderId: string,
    vehicleIds: string[]
  ): void {
    for (const vehicleId of vehicleIds) {
      tx.insert(reminderVehicles).values({ reminderId, vehicleId }).run();
    }
  }

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

  private async attachVehicleIds(reminderList: Reminder[]): Promise<ReminderWithVehicles[]> {
    const ids = reminderList.map((r) => r.id);
    const vehicleMap = await this.getVehicleIdsForReminders(ids);
    return reminderList.map((reminder) => ({
      reminder,
      vehicleIds: vehicleMap.get(reminder.id) ?? [],
    }));
  }

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
   * Unscoped by user, because a shared vehicle's reminder is stamped with the owner's id and a
   * user-scoped lookup would hide it from an editor. Callers authorize against its vehicleIds.
   */
  async findByIdWithVehicles(id: string): Promise<ReminderWithVehicles | null> {
    const result = await this.db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
    const reminder = result[0];
    if (!reminder) return null;
    const vehicleIds = await this.getVehicleIds(id);
    return { reminder, vehicleIds };
  }

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
   * Returns candidates only: due-ness depends on each vehicle's current odometer, which SQL cannot see,
   * so the trigger service checks `currentOdometer >= nextDueOdometer` for each.
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
   * App-level dedup for mileage notifications. The partial unique index on (reminderId, dueOdometer) is
   * the database backstop.
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
   * Returns null when a concurrent pass already wrote this milestone (unique index violation).
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
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw new DatabaseError('Failed to create mileage notification', error);
    }
  }

  /**
   * Creates the reminder and its junction rows atomically. The caller supplies nextDueDate and mileage fields.
   */
  async createWithVehicles(data: NewReminder, vehicleIds: string[]): Promise<ReminderWithVehicles> {
    try {
      // Synchronous so a failed junction insert rolls back the reminder too; see insertVehicleJunctionsSync.
      return transaction((tx) => {
        const reminder = tx.insert(reminders).values(data).returning().get();

        this.insertVehicleJunctionsSync(tx, reminder.id, vehicleIds);

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
   * Passing vehicleIds fully replaces the junction rows, in the same synchronous transaction.
   */
  async updateWithVehicles(
    id: string,
    userId: string,
    data: Partial<NewReminder>,
    vehicleIds?: string[]
  ): Promise<ReminderWithVehicles> {
    try {
      return transaction((tx) => {
        const existing = tx
          .select()
          .from(reminders)
          .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
          .limit(1)
          .all();

        if (existing.length === 0) {
          throw new NotFoundError('Reminder');
        }

        const updateData = { ...data, updatedAt: new Date() };
        const reminder = tx
          .update(reminders)
          .set(updateData)
          .where(eq(reminders.id, id))
          .returning()
          .get();

        if (vehicleIds) {
          tx.delete(reminderVehicles).where(eq(reminderVehicles.reminderId, id)).run();
          this.insertVehicleJunctionsSync(tx, id, vehicleIds);
        }

        const currentVehicleIds =
          vehicleIds ??
          tx
            .select({ vehicleId: reminderVehicles.vehicleId })
            .from(reminderVehicles)
            .where(eq(reminderVehicles.reminderId, id))
            .all()
            .map((r) => r.vehicleId);

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
   * Compare-and-swap of nextDueDate inside the caller's transaction. Returns false when another trigger
   * already claimed the period, and the caller must not materialize it. Must stay synchronous: awaited
   * statements inside a bun-sqlite transaction autocommit separately, so the claim would not guard the rows.
   */
  claimPeriodSync(
    tx: DrizzleTransaction,
    id: string,
    expectedCurrentDueDate: Date,
    nextDueDate: Date,
    lastTriggeredAt: Date
  ): boolean {
    const claimed = tx
      .update(reminders)
      .set({ nextDueDate, lastTriggeredAt, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.nextDueDate, expectedCurrentDueDate)))
      .returning({ id: reminders.id })
      .all();
    return claimed.length > 0;
  }

  async deactivate(id: string): Promise<void> {
    await this.db
      .update(reminders)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(reminders.id, id));
  }

  /**
   * Deactivates active reminders left with no vehicles after a vehicle delete. The junction rows cascade,
   * but the reminder row survives, and the trigger would otherwise skip it on every run.
   */
  async deactivateVehicleless(userId: string): Promise<number> {
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
   * Prunes a deleted vehicle from split configs. The split JSON is not FK-managed, so this must run
   * before deactivateVehicleless. Returns the number of configs changed.
   */
  async pruneSplitConfigsForDeletedVehicle(
    userId: string,
    deletedVehicleId: string
  ): Promise<number> {
    const rows = await this.db
      .select({ id: reminders.id, expenseSplitConfig: reminders.expenseSplitConfig })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), isNotNull(reminders.expenseSplitConfig)));

    let changed = 0;
    for (const row of rows) {
      const config = row.expenseSplitConfig;
      if (!config) continue;
      const pruned = pruneVehicleFromSplitConfig(config, deletedVehicleId);
      // The helper returns the same reference when nothing changed.
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
   * Applies a mark-serviced re-arm. Only the axis fields passed in are written, and lastTriggeredAt is stamped.
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

  async findNotifications(userId: string, unreadOnly?: boolean): Promise<ReminderNotification[]> {
    try {
      const conditions: SQL[] = [eq(reminderNotifications.userId, userId)];

      if (unreadOnly) {
        conditions.push(eq(reminderNotifications.isRead, false));
      }

      return await this.db
        .select()
        .from(reminderNotifications)
        // Order by createdAt, not dueDate: mileage notifications have a null dueDate, and NULLs sort last
        // under DESC, which would bury them beneath every time notification.
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

export const reminderRepository = new ReminderRepository(getDb());
