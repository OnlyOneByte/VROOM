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
  const { updated, cleared } = await appContext().asyncDb.transaction(async (tx) => {
    const [row] = await tx
      .update(vehicleFinancing)
      .set({ isActive: false, endDate: now, updatedAt: now })
      .where(eq(vehicleFinancing.id, financingId))
      .returning();
    if (!row) {
      throw new NotFoundError('Resource');
    }
    const detached = await tx
      .update(expenses)
      .set({ sourceType: null, sourceId: null })
      .where(
        and(
          eq(expenses.sourceType, 'financing'),
          eq(expenses.sourceId, financingId),
          eq(expenses.userId, userId)
        )
      )
      .returning({ id: expenses.id });
    return { updated: row, cleared: detached.length };
  });
  if (cleared > 0) {
    logger.info('Cleared financing source on expenses', { financingId, cleared });
  }
  return updated;
}
