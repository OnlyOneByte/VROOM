import type { SplitConfig } from '../../db/types';

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
