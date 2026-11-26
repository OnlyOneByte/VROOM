import { and, eq } from 'drizzle-orm';
import { appContext } from '../../app-context';
import { expenses, type VehicleFinancing, vehicleFinancing } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';

export async function deactivateFinancing(
  financingId: string,
  userId: string
): Promise<VehicleFinancing> {
  const now = new Date();
  const { updated, cleared } = appContext().db.transaction((tx) => {
    const row = tx
      .update(vehicleFinancing)
      .set({ isActive: false, endDate: now, updatedAt: now })
      .where(eq(vehicleFinancing.id, financingId))
      .returning()
      .get();
    if (!row) {
      throw new NotFoundError('Resource');
    }
    const detached = tx
      .update(expenses)
      .set({ sourceType: null, sourceId: null })
      .where(
        and(
          eq(expenses.sourceType, 'financing'),
          eq(expenses.sourceId, financingId),
          eq(expenses.userId, userId)
        )
      )
      .returning({ id: expenses.id })
      .all();
    return { updated: row, cleared: detached.length };
  });
  if (cleared > 0) {
    logger.info('Cleared financing source on expenses', { financingId, cleared });
  }
  return updated;
}
