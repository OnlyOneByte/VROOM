import type { VehicleFinancing } from '../../db/schema';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { financingRepository } from './repository';

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

async function onFinancingDeactivated(financingId: string, userId: string): Promise<void> {
  try {
    const cleared = await expenseRepository.clearSource('financing', financingId, userId);
    if (cleared > 0) {
      logger.info('Cleared financing source on expenses', { financingId, cleared });
    }
  } catch (error) {
    logger.error('Failed to clear financing source on expenses', {
      financingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
