import type { ReminderSplitConfig } from '../../db/types';

/**
 * Drop a deleted vehicle from a reminder's `expenseSplitConfig` blob and renormalize (#88).
 *
 * `expenseSplitConfig` is a JSON blob (NOT FK-managed like the reminder_vehicles junction), so when a
 * vehicle is deleted its leg lingers in the blob. On the next trigger `createExpenseFromReminder` builds
 * siblings from the blob's vehicleIds → an INSERT for the dead vehicleId → an FK violation that (via the
 * C151 async-tx footgun) leaves the surviving legs partially committed. This prunes the deleted leg:
 *
 *   - `even`        → drop the id from `vehicleIds`.
 *   - `absolute`    → drop the allocation; the remaining fixed amounts stand (the group total shrinks,
 *                     which is the honest result — we never invent a redistribution).
 *   - `percentage`  → drop the allocation, then RESCALE the survivors back to 100% proportionally so the
 *                     split stays well-formed (refineSplitConfig requires percentages sum to 100). When
 *                     the survivors sum to 0 (all were 0%), fall back to an even percentage split.
 *
 * Returns:
 *   - the renormalized config when ≥2 legs remain (still a real split),
 *   - `null` when 0 or 1 legs remain → the caller clears the blob so the reminder falls back to the
 *     junction-driven single-vehicle path (and a now-vehicleless reminder is handled by deactivateVehicleless),
 *   - the ORIGINAL reference (unchanged) when the deleted id wasn't in the config — lets the caller skip the write.
 */
export function pruneVehicleFromSplitConfig(
  config: ReminderSplitConfig,
  deletedVehicleId: string
): ReminderSplitConfig | null {
  if (config.method === 'even') {
    if (!config.vehicleIds.includes(deletedVehicleId)) return config;
    const remaining = config.vehicleIds.filter((id) => id !== deletedVehicleId);
    return remaining.length >= 2 ? { method: 'even', vehicleIds: remaining } : null;
  }

  if (config.method === 'absolute') {
    if (!config.allocations.some((a) => a.vehicleId === deletedVehicleId)) return config;
    const remaining = config.allocations.filter((a) => a.vehicleId !== deletedVehicleId);
    return remaining.length >= 2 ? { method: 'absolute', allocations: remaining } : null;
  }

  // percentage
  if (!config.allocations.some((a) => a.vehicleId === deletedVehicleId)) return config;
  const remaining = config.allocations.filter((a) => a.vehicleId !== deletedVehicleId);
  if (remaining.length < 2) return null;

  const sum = remaining.reduce((acc, a) => acc + a.percentage, 0);
  const rescaled =
    sum > 0
      ? remaining.map((a) => ({ vehicleId: a.vehicleId, percentage: (a.percentage / sum) * 100 }))
      : remaining.map((a) => ({ vehicleId: a.vehicleId, percentage: 100 / remaining.length }));
  return { method: 'percentage', allocations: rescaled };
}
