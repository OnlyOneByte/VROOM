import { createId } from '@paralleldrive/cuid2';
import { and, count, desc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import type { NewOdometerEntry, OdometerEntry } from '../../db/schema';
import { odometerEntries } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';

export class OdometerRepository extends BaseRepository<OdometerEntry, NewOdometerEntry> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, odometerEntries);
  }

  async findByVehicleIdPaginated(
    vehicleId: string,
    limit: number,
    offset: number
  ): Promise<{ data: OdometerEntry[]; totalCount: number }> {
    const data = await this.db
      .select()
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId))
      .orderBy(desc(odometerEntries.recordedAt))
      .limit(limit)
      .offset(offset);

    const [result] = await this.db
      .select({ count: count() })
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId));

    return { data, totalCount: result?.count ?? 0 };
  }

  async findByLinkedEntity(entityType: string, entityId: string): Promise<OdometerEntry | null> {
    const result = await this.db
      .select()
      .from(odometerEntries)
      .where(
        and(
          eq(odometerEntries.linkedEntityType, entityType),
          eq(odometerEntries.linkedEntityId, entityId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  async upsertFromLinkedEntity(params: {
    vehicleId: string;
    userId: string;
    odometer: number;
    recordedAt: Date;
    linkedEntityType: string;
    linkedEntityId: string;
  }): Promise<OdometerEntry> {
    const existing = await this.findByLinkedEntity(params.linkedEntityType, params.linkedEntityId);

    if (existing) {
      const [updated] = await this.db
        .update(odometerEntries)
        .set({
          odometer: params.odometer,
          recordedAt: params.recordedAt,
          updatedAt: new Date(),
        })
        .where(eq(odometerEntries.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await this.db
      .insert(odometerEntries)
      .values({
        id: createId(),
        vehicleId: params.vehicleId,
        userId: params.userId,
        odometer: params.odometer,
        recordedAt: params.recordedAt,
        linkedEntityType: params.linkedEntityType,
        linkedEntityId: params.linkedEntityId,
      })
      .returning();

    return created;
  }

  async deleteByLinkedEntity(entityType: string, entityId: string): Promise<void> {
    await this.db
      .delete(odometerEntries)
      .where(
        and(
          eq(odometerEntries.linkedEntityType, entityType),
          eq(odometerEntries.linkedEntityId, entityId)
        )
      );
  }
}

export const odometerRepository = new OdometerRepository(getDb());
