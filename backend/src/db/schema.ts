import { sql } from 'drizzle-orm';
import { ACTIVE_DIALECT } from './dialect/active';
import * as pg from './pg/schema';
import * as sqlite from './sqlite/schema';

const onPostgres = ACTIVE_DIALECT === 'pg';

function active<T>(sqliteTable: T, pgTable: unknown): T {
  return (onPostgres ? pgTable : sqliteTable) as T;
}

export type {
  BackfilledEntry,
  CalendarFeed,
  CalendarFeedOptions,
  CommunityStat,
  Expense,
  InsuranceClaim,
  InsurancePolicy,
  InsuranceTerm,
  InsuranceTermVehicle,
  NewCommunityStat,
  NewExpense,
  NewOdometerEntry,
  NewPhoto,
  NewPhotoRef,
  NewPushSubscription,
  NewReminder,
  NewReminderNotification,
  NewReminderVehicle,
  NewTrip,
  NewUserPreferences,
  NewVehicle,
  NewVehicleFinancing,
  NewVehicleShare,
  OdometerEntry,
  Photo,
  PhotoRef,
  PushSubscription,
  Reminder,
  ReminderNotification,
  ReminderVehicle,
  Role,
  Session,
  SplitMethod,
  SyncState,
  Trip,
  User,
  UserPreferences,
  UserProvider,
  Vehicle,
  VehicleDriver,
  VehicleFinancing,
  VehicleShare,
  VehicleWithFinancing,
} from './sqlite/schema';

export const users = active(sqlite.users, pg.users);
export const vehicles = active(sqlite.vehicles, pg.vehicles);
export const vehicleDrivers = active(sqlite.vehicleDrivers, pg.vehicleDrivers);
export const driverBackfills = active(sqlite.driverBackfills, pg.driverBackfills);
export const vehicleFinancing = active(sqlite.vehicleFinancing, pg.vehicleFinancing);
export const insurancePolicies = active(sqlite.insurancePolicies, pg.insurancePolicies);
export const insuranceTerms = active(sqlite.insuranceTerms, pg.insuranceTerms);
export const insuranceTermVehicles = active(sqlite.insuranceTermVehicles, pg.insuranceTermVehicles);
export const insuranceClaims = active(sqlite.insuranceClaims, pg.insuranceClaims);
export const expenses = active(sqlite.expenses, pg.expenses);
export const userProviders = active(sqlite.userProviders, pg.userProviders);
export const userPreferences = active(sqlite.userPreferences, pg.userPreferences);
export const syncState = active(sqlite.syncState, pg.syncState);
export const sessions = active(sqlite.sessions, pg.sessions);
export const odometerEntries = active(sqlite.odometerEntries, pg.odometerEntries);
export const trips = active(sqlite.trips, pg.trips);
export const photos = active(sqlite.photos, pg.photos);
export const photoRefs = active(sqlite.photoRefs, pg.photoRefs);
export const reminders = active(sqlite.reminders, pg.reminders);
export const reminderVehicles = active(sqlite.reminderVehicles, pg.reminderVehicles);
export const reminderNotifications = active(sqlite.reminderNotifications, pg.reminderNotifications);
export const vehicleShares = active(sqlite.vehicleShares, pg.vehicleShares);
export const roles = active(sqlite.roles, pg.roles);
export const rolePermissions = active(sqlite.rolePermissions, pg.rolePermissions);
export const roleAssignments = active(sqlite.roleAssignments, pg.roleAssignments);
export const permissionOverrides = active(sqlite.permissionOverrides, pg.permissionOverrides);
export const calendarFeeds = active(sqlite.calendarFeeds, pg.calendarFeeds);
export const pushSubscriptions = active(sqlite.pushSubscriptions, pg.pushSubscriptions);
export const communityStats = active(sqlite.communityStats, pg.communityStats);
export const communityRefreshes = active(sqlite.communityRefreshes, pg.communityRefreshes);
export const communityNoiseKeys = active(sqlite.communityNoiseKeys, pg.communityNoiseKeys);
export const moneyUnitMigrations = active(sqlite.moneyUnitMigrations, pg.moneyUnitMigrations);
export const serverSettings = active(sqlite.serverSettings, pg.serverSettings);
export const serverInvites = active(sqlite.serverInvites, pg.serverInvites);

export const insuranceTermVehicleSelectionOrder = insuranceTermVehicles.position;
export const nextInsuranceTermVehiclePosition = sql<number>`(SELECT COALESCE(MAX(${insuranceTermVehicles.position}), 0) + 1 FROM ${insuranceTermVehicles})`;
