/**
 * Financing Hooks
 *
 * Cross-domain side effects triggered by financing operations.
 * Called from route handlers, not from the repository.
 */

import { logger } from '../../utils/logger';
import { expenseRepository } from '../expenses/repository';

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
