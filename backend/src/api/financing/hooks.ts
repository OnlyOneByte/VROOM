import type { VehicleFinancing } from '../../db/schema';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { financingRepository } from './repository';

/**
 * Marks the financing inactive, stamps endDate, and unlinks its expenses. Callers must validate
 * ownership first.
 */
export async function deactivateFinancing(
  financingId: string,
  userId: string
): Promise<VehicleFinancing> {
  const updated = await financingRepository.update(financingId, {
    isActive: false,
    endDate: new Date(),
  });
  await onFinancingDeactivated(financingId, userId);
  return updated;
}

/** Clears the source link on expenses for a financing; the expense rows themselves are kept. */
async function onFinancingDeactivated(financingId: string, userId: string): Promise<void> {
  try {
    const cleared = await expenseRepository.clearSource('financing', financingId, userId);
    if (cleared > 0) {
      logger.info('Cleared financing source on expenses', { financingId, cleared });
    }
  } catch (error) {
    // Non-fatal: the deactivation itself has already succeeded.
    logger.error('Failed to clear financing source on expenses', {
      financingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
