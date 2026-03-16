import { and, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb, transaction } from '../../db/connection';
import type { NewReminder, Reminder, ReminderNotification } from '../../db/schema';
import { reminderNotifications, reminders, reminderVehicles } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

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
   * Find all reminders associated with a specific vehicle for a user.
   */
  async findByVehicleId(vehicleId: string, userId: string): Promise<Reminder[]> {
    try {
      const rows = await this.db
        .select({ reminder: reminders })
        .from(reminders)
        .innerJoin(reminderVehicles, eq(reminders.id, reminderVehicles.reminderId))
        .where(and(eq(reminderVehicles.vehicleId, vehicleId), eq(reminders.userId, userId)));
      return rows.map((r) => r.reminder);
    } catch (error) {
      logger.error('Failed to find reminders for vehicle', {
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find reminders for vehicle', error);
    }
  }

  // --------------------------------------------------------------------------
  // Mutation methods
  // --------------------------------------------------------------------------

  /**
   * Create a reminder with associated vehicle junction rows in a single transaction.
   * Sets nextDueDate = startDate.
   */
  async createWithVehicles(data: NewReminder, vehicleIds: string[]): Promise<ReminderWithVehicles> {
    try {
      return await transaction(async (tx) => {
        const reminderData = { ...data, nextDueDate: data.startDate };
        const result = await tx.insert(reminders).values(reminderData).returning();
        const reminder = result[0];

        for (const vehicleId of vehicleIds) {
          await tx.insert(reminderVehicles).values({ reminderId: reminder.id, vehicleId });
        }

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

          for (const vehicleId of vehicleIds) {
            await tx.insert(reminderVehicles).values({ reminderId: id, vehicleId });
          }
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
        .where(and(...conditions));
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
