import { getTableColumns, is, SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  getTableConfig,
  type SQLiteColumn,
  SQLiteColumn as SQLiteColumnClass,
  type SQLiteTable,
} from 'drizzle-orm/sqlite-core';
import * as sqlite from '../sqlite/schema';

export const epochSeconds = customType<{ data: Date; driverData: number | string | bigint }>({
  dataType: () => 'bigint',
  toDriver: (value) => Math.floor(value.getTime() / 1000),
  fromDriver: (value) => new Date(Number(value) * 1000),
});

interface Chain extends PgColumnBuilderBase {
  primaryKey(): Chain;
  notNull(): Chain;
  unique(name?: string): Chain;
  default(value: unknown): Chain;
  $defaultFn(fn: () => unknown): Chain;
  $onUpdateFn(fn: () => unknown): Chain;
  generatedByDefaultAsIdentity(): Chain;
}

type ColumnMap = Record<string, AnyPgColumn>;

const twins = new Map<SQLiteTable, ColumnMap>();
const keys = new Map<SQLiteColumn, string>();

export const PG_INDEX_WHERE: Record<string, (columns: ColumnMap) => SQL> = {
  vf_active_vehicle_idx: (t) => new SQL([t.isActive as AnyPgColumn]),
};

function keyOf(column: SQLiteColumn): string {
  const key = keys.get(column);
  if (!key) throw new Error(`No column key for ${column.name}`);
  return key;
}

function twinColumn(column: SQLiteColumn): AnyPgColumn {
  const twin = twins.get(column.table)?.[keyOf(column)];
  if (!twin) throw new Error(`No Postgres twin for ${column.name}`);
  return twin;
}

function rebind(query: SQL): SQL {
  return new SQL(
    query.queryChunks.map((chunk) => {
      if (is(chunk, SQLiteColumnClass)) return twinColumn(chunk);
      if (is(chunk, SQL)) return rebind(chunk);
      return chunk;
    })
  );
}

function baseColumn(column: SQLiteColumn): Chain {
  const name = column.name;
  switch (column.columnType) {
    case 'SQLiteTimestamp':
      return epochSeconds(name) as unknown as Chain;
    case 'SQLiteBoolean':
      return boolean(name) as unknown as Chain;
    case 'SQLiteInteger':
      return bigint(name, { mode: 'number' }) as unknown as Chain;
    case 'SQLiteReal':
      return doublePrecision(name) as unknown as Chain;
    case 'SQLiteTextJson':
      return jsonb(name) as unknown as Chain;
    case 'SQLiteText':
      return (column.enumValues?.length
        ? text(name, { enum: column.enumValues as [string, ...string[]] })
        : text(name)) as unknown as Chain;
    default:
      throw new Error(`No Postgres type for ${column.columnType} (${name})`);
  }
}

function pgColumn(column: SQLiteColumn): Chain {
  let built = baseColumn(column);
  if (column.primary) built = built.primaryKey();
  else if (column.notNull) built = built.notNull();
  if (column.primary && column.columnType === 'SQLiteInteger') {
    built = built.generatedByDefaultAsIdentity();
  }
  if (column.isUnique) built = built.unique(column.uniqueName);
  if (column.default !== undefined) {
    built = built.default(is(column.default, SQL) ? rebind(column.default) : column.default);
  }
  if (column.defaultFn) built = built.$defaultFn(column.defaultFn);
  if (column.onUpdateFn) built = built.$onUpdateFn(column.onUpdateFn);
  return built;
}

function extraConfig(source: SQLiteTable, t: ColumnMap): PgTableExtraConfigValue[] {
  const config = getTableConfig(source);
  const own = (columns: SQLiteColumn[]) => columns.map((c) => t[keyOf(c)] as AnyPgColumn);
  const out: PgTableExtraConfigValue[] = [];
  for (const pk of config.primaryKeys) {
    out.push(primaryKey({ name: pk.getName(), columns: own(pk.columns) as [AnyPgColumn] }));
  }
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    let built = foreignKey({
      name: fk.getName(),
      columns: own(ref.columns) as [AnyPgColumn],
      foreignColumns: ref.foreignColumns.map(twinColumn) as [AnyPgColumn],
    });
    if (fk.onDelete) built = built.onDelete(fk.onDelete);
    if (fk.onUpdate) built = built.onUpdate(fk.onUpdate);
    out.push(built);
  }
  for (const idx of config.indexes) {
    const { name, unique, where } = idx.config;
    const columns = idx.config.columns.map((c) =>
      is(c, SQL) ? rebind(c) : t[keyOf(c as SQLiteColumn)]
    ) as [AnyPgColumn];
    const built = (unique ? uniqueIndex : index)(name).on(...columns);
    const pgWhere = PG_INDEX_WHERE[name]?.(t) ?? (where ? rebind(where) : undefined);
    out.push(pgWhere ? built.where(pgWhere) : built);
  }
  return out;
}

function pgTwin<T extends SQLiteTable>(source: T) {
  const columns: Record<string, Chain> = {};
  for (const [key, column] of Object.entries(getTableColumns(source))) {
    keys.set(column, key);
    columns[key] = pgColumn(column);
  }
  const table = pgTable(getTableConfig(source).name, columns, (t) =>
    extraConfig(source, t as unknown as ColumnMap)
  );
  twins.set(source, table as unknown as ColumnMap);
  return table;
}

export const users = pgTwin(sqlite.users);
export const vehicles = pgTwin(sqlite.vehicles);
export const vehicleDrivers = pgTwin(sqlite.vehicleDrivers);
export const driverBackfills = pgTwin(sqlite.driverBackfills);
export const vehicleFinancing = pgTwin(sqlite.vehicleFinancing);
export const insurancePolicies = pgTwin(sqlite.insurancePolicies);
export const insuranceTerms = pgTwin(sqlite.insuranceTerms);
export const insuranceTermVehicles = pgTwin(sqlite.insuranceTermVehicles);
export const insuranceClaims = pgTwin(sqlite.insuranceClaims);
export const expenses = pgTwin(sqlite.expenses);
export const userProviders = pgTwin(sqlite.userProviders);
export const userPreferences = pgTwin(sqlite.userPreferences);
export const syncState = pgTwin(sqlite.syncState);
export const sessions = pgTwin(sqlite.sessions);
export const odometerEntries = pgTwin(sqlite.odometerEntries);
export const trips = pgTwin(sqlite.trips);
export const photos = pgTwin(sqlite.photos);
export const photoRefs = pgTwin(sqlite.photoRefs);
export const reminders = pgTwin(sqlite.reminders);
export const reminderVehicles = pgTwin(sqlite.reminderVehicles);
export const reminderNotifications = pgTwin(sqlite.reminderNotifications);
export const vehicleShares = pgTwin(sqlite.vehicleShares);
export const roles = pgTwin(sqlite.roles);
export const rolePermissions = pgTwin(sqlite.rolePermissions);
export const roleAssignments = pgTwin(sqlite.roleAssignments);
export const permissionOverrides = pgTwin(sqlite.permissionOverrides);
export const calendarFeeds = pgTwin(sqlite.calendarFeeds);
export const pushSubscriptions = pgTwin(sqlite.pushSubscriptions);
export const communityStats = pgTwin(sqlite.communityStats);
export const communityRefreshes = pgTwin(sqlite.communityRefreshes);
export const communityNoiseKeys = pgTwin(sqlite.communityNoiseKeys);
export const communityReleaseMembers = pgTwin(sqlite.communityReleaseMembers);
export const moneyUnitMigrations = pgTwin(sqlite.moneyUnitMigrations);
export const serverSettings = pgTwin(sqlite.serverSettings);
export const serverInvites = pgTwin(sqlite.serverInvites);
