import type { SplitConfig } from '../../db/types';

/**
 * Removes a deleted vehicle from a split config. The config is JSON and not FK-managed, so the leg would
 * otherwise linger. Percentage splits are rescaled to 100. Returns null when fewer than two legs remain,
 * meaning the caller should clear the config, and the same reference when the vehicle was absent.
 */
export function pruneVehicleFromSplitConfig(
  config: SplitConfig,
  deletedVehicleId: string
): SplitConfig | null {
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
