import { type SQL, sql } from 'drizzle-orm';
import { sqlFalse } from '../../db/dialect';
import { FINANCIAL_SOURCE_TYPES, type ReadableVehicle } from '../../utils/vehicle-access';
import { OWNERSHIP_CATEGORIES } from '../expenses/repository';

type Alias = 'e' | 'x' | 't';

function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

function hiddenFinancials(alias: Alias): SQL {
  const source = sql.raw(`${alias}.source_type`);
  const category = sql.raw(`${alias}.category`);
  return sql`(${source} IS NULL OR ${source} NOT IN (${list(FINANCIAL_SOURCE_TYPES)})) AND ${category} NOT IN (${list(OWNERSHIP_CATEGORIES)})`;
}

export function ownedRowsOf(
  alias: Alias,
  scope: readonly ReadableVehicle[],
  { expenses }: { expenses: boolean }
): SQL {
  if (scope.length === 0) return sqlFalse();
  const vehicle = sql.raw(`${alias}.vehicle_id`);
  const owner = sql.raw(`${alias}.user_id`);
  const parts = scope.map((v) => {
    const hide = expenses && v.hideFinancials ? sql` AND ${hiddenFinancials(alias)}` : sql``;
    return sql`(${vehicle} = ${v.vehicleId} AND ${owner} = ${v.ownerId}${hide})`;
  });
  return sql`(${sql.join(parts, sql` OR `)})`;
}

export function ownedScope(userId: string, vehicleIds: readonly string[]): ReadableVehicle[] {
  return vehicleIds.map((vehicleId) => ({ vehicleId, ownerId: userId, hideFinancials: false }));
}
