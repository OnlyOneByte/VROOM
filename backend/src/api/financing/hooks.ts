/**
 * Financing Hooks
 *
 * Cross-domain side effects triggered by financing operations.
 * Called from route handlers, not from the repository.
 */

import type { VehicleFinancing } from '../../db/schema';
import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';
import { financingRepository } from './repository';

/**
 * Deactivate a financing record (mark inactive + stamp endDate) AND run the deactivation side
 * effect. The ONE source of truth for "this financing is now done" — the payoff (PUT /:id/payoff)
 * and delete (DELETE /:id) routes ran this byte-identical `update({isActive:false, endDate}) +
 * onFinancingDeactivated` pair separately, so a future change to what deactivation entails (extra
 * cleanup, the #67/C206 re-finance reset) would otherwise have to land in both. The caller is
 * expected to have already validated ownership. Returns the updated row (the payoff route echoes it;
 * delete ignores it).
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

/**
 * Null-out source fields on expenses linked to a financing record.
 * Called when financing is deactivated (payoff or delete).
 * Keeps the expense records — only severs the link.
 */
export async function onFinancingDeactivated(financingId: string, userId: string): Promise<void> {
  try {
    const cleared = await expenseRepository.clearSource('financing', financingId, userId);
    if (cleared > 0) {
      logger.info('Cleared financing source on expenses', { financingId, cleared });
    }
  } catch (error) {
    // Log but don't fail the financing operation
    logger.error('Failed to clear financing source on expenses', {
      financingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
