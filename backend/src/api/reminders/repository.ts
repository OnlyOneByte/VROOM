import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AsyncAppDatabase, AsyncHandle } from '../../db/async-sqlite';
import type { NewReminder, Reminder, ReminderNotification } from '../../db/schema';
import { reminderNotifications, reminders, reminderVehicles } from '../../db/schema';
import { DatabaseError, isUniqueConstraintError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';
import { absoluteTotalAfterPrune, pruneVehicleFromSplitConfig } from './split-config-helpers';

export interface ReminderWithVehicles {
  reminder: Reminder;
  vehicleIds: string[];
}

interface ReminderFilters {
  vehicleId?: string;
  type?: string;
  isActive?: boolean;
}

export class ReminderRepository extends BaseRepository<Reminder, NewReminder> {
  constructor(db: AsyncAppDatabase) {
    super(db, reminders);
  }

  private async getVehicleIds(handle: AsyncHandle, reminderId: string): Promise<string[]> {
    const rows = await handle
      .select({ vehicleId: reminderVehicles.vehicleId })
      .from(reminderVehicles)
      .where(eq(reminderVehicles.reminderId, reminderId));
    return rows.map((r) => r.vehicleId);
  }

  private async insertVehicleJunctions(
    tx: AsyncHandle,
    reminderId: string,
    vehicleIds: string[]
  ): Promise<void> {
    for (const vehicleId of vehicleIds) {
      await tx.insert(reminderVehicles).values({ reminderId, vehicleId });
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

    const vehicleIds = await this.getVehicleIds(this.db, id);
    return { reminder, vehicleIds };
  }

  // Unscoped by user: callers must authorize against the returned vehicleIds.
  async findByIdWithVehicles(id: string): Promise<ReminderWithVehicles | null> {
    const result = await this.db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
    const reminder = result[0];
    if (!reminder) return null;
    const vehicleIds = await this.getVehicleIds(this.db, id);
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

  async createMileageNotification(
    reminderId: string,
    userId: string,
    dueOdometer: number
  ): Promise<ReminderNotification | null> {
    try {
      const [created] = await this.db
        .insert(reminderNotifications)
        .values({ reminderId, userId, dueDate: null, dueOdometer, isRead: false })
        .onConflictDoNothing()
        .returning();
      return created ?? null;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return null;
      }
      throw new DatabaseError('Failed to create mileage notification', error);
    }
  }

  async createWithVehicles(data: NewReminder, vehicleIds: string[]): Promise<ReminderWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        const [reminder] = await tx.insert(reminders).values(data).returning();
        if (!reminder) throw new Error('Reminder insert returned no row');
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

  async updateWithVehicles(
    id: string,
    userId: string,
    data: Partial<NewReminder>,
    vehicleIds?: string[]
  ): Promise<ReminderWithVehicles> {
    try {
      return await this.db.transaction(async (tx) => {
        const [reminder] = await tx
          .update(reminders)
          .set({ ...data, updatedAt: new Date() })
          .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
          .returning();
        if (!reminder) throw new NotFoundError('Reminder');

        if (vehicleIds) {
          await tx.delete(reminderVehicles).where(eq(reminderVehicles.reminderId, id));
          await this.insertVehicleJunctions(tx, id, vehicleIds);
        }

        return { reminder, vehicleIds: vehicleIds ?? (await this.getVehicleIds(tx, id)) };
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

  async claimPeriod(
    tx: AsyncHandle,
    id: string,
    expectedCurrentDueDate: Date,
    nextDueDate: Date,
    lastTriggeredAt: Date
  ): Promise<Reminder | null> {
    const [claimed] = await tx
      .update(reminders)
      .set({ nextDueDate, lastTriggeredAt, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.nextDueDate, expectedCurrentDueDate)))
      .returning();
    return claimed ?? null;
  }

  async deactivate(id: string, userId: string): Promise<void> {
    await this.db
      .update(reminders)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)));
  }

  async deleteOwned(id: string, userId: string): Promise<void> {
    const result = await this.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .returning({ id: reminders.id });
    if (result.length === 0) throw new NotFoundError('Reminder');
  }

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

  // Split JSON is not FK-managed: the vehicle delete does not prune it, so this must be called explicitly.
  async pruneSplitConfigsForDeletedVehicle(
    userId: string,
    deletedVehicleId: string
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: reminders.id, expenseSplitConfig: reminders.expenseSplitConfig })
        .from(reminders)
        .where(and(eq(reminders.userId, userId), isNotNull(reminders.expenseSplitConfig)));

      let changed = 0;
      for (const row of rows) {
        const config = row.expenseSplitConfig;
        if (!config) continue;
        const pruned = pruneVehicleFromSplitConfig(config, deletedVehicleId);
        if (pruned === config) continue;
        const absoluteTotal = absoluteTotalAfterPrune(config, deletedVehicleId);
        await tx
          .update(reminders)
          .set({
            expenseSplitConfig: pruned,
            ...(absoluteTotal === null ? {} : { expenseAmount: absoluteTotal }),
            updatedAt: new Date(),
          })
          .where(and(eq(reminders.id, row.id), eq(reminders.userId, userId)));
        changed++;
      }
      return changed;
    });
  }

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
        .where(and(...conditions))
        // Order by createdAt: a null dueDate (mileage notifications) sorts last under DESC.
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
