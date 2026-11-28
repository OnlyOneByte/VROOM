import type { Database } from 'bun:sqlite';
import { AnalyticsInsightsRepository } from './api/analytics/insights';
import { AnalyticsQueryRepository } from './api/analytics/query-repository';
import { AnalyticsRepository } from './api/analytics/repository';
import { AuthProviderRepository } from './api/auth/auth-provider-repository';
import { createLucia } from './api/auth/lucia';
import { CommunityStatsRepository } from './api/community/repository';
import { ExpenseRepository } from './api/expenses/repository';
import { FinancingRepository } from './api/financing/repository';
import { InsuranceClaimRepository } from './api/insurance/claims-repository';
import { InsurancePolicyRepository } from './api/insurance/repository';
import { OdometerRepository } from './api/odometer/repository';
import { PhotoRefRepository } from './api/photos/photo-ref-repository';
import { PhotoRepository } from './api/photos/photo-repository';
import { PushSubscriptionRepository } from './api/push/repository';
import { ReminderRepository } from './api/reminders/repository';
import { PreferencesRepository, SyncStateRepository } from './api/settings/repository';
import { VehicleShareRepository } from './api/shares/repository';
import { TripRepository } from './api/trips/repository';
import { VehicleRepository } from './api/vehicles/repository';
import { CONFIG } from './config';
import { type AsyncPgDatabase, portableDatabase } from './db/async-postgres';
import { type AsyncAppDatabase, openAsyncDatabase } from './db/async-sqlite';
import { getDb } from './db/connection';
import { ACTIVE_DIALECT } from './db/dialect/active';

export function createAppContext(sqlite: Database) {
  const asyncDb = openAsyncDatabase(sqlite).db;
  return contextOn(asyncDb, createLucia(asyncDb));
}

export function createPostgresAppContext(db: AsyncPgDatabase): AppContext {
  return contextOn(portableDatabase(db), createLucia(db, 'pg'));
}

function contextOn(asyncDb: AsyncAppDatabase, lucia: ReturnType<typeof createLucia>) {
  const analyticsQuery = new AnalyticsQueryRepository(asyncDb);
  return {
    asyncDb,
    lucia,
    repos: {
      analytics: new AnalyticsRepository(asyncDb),
      analyticsInsights: new AnalyticsInsightsRepository(asyncDb, analyticsQuery),
      analyticsQuery,
      authProviders: new AuthProviderRepository(asyncDb),
      communityStats: new CommunityStatsRepository(asyncDb),
      expenses: new ExpenseRepository(asyncDb),
      financing: new FinancingRepository(asyncDb),
      insuranceClaims: new InsuranceClaimRepository(asyncDb),
      insurancePolicies: new InsurancePolicyRepository(asyncDb),
      odometer: new OdometerRepository(asyncDb),
      photoRefs: new PhotoRefRepository(asyncDb),
      photos: new PhotoRepository(asyncDb),
      preferences: new PreferencesRepository(asyncDb),
      pushSubscriptions: new PushSubscriptionRepository(asyncDb),
      reminders: new ReminderRepository(asyncDb),
      syncState: new SyncStateRepository(asyncDb),
      trips: new TripRepository(asyncDb),
      vehicles: new VehicleRepository(asyncDb),
      vehicleShares: new VehicleShareRepository(asyncDb),
    },
  };
}

export type AppContext = ReturnType<typeof createAppContext>;

let current: AppContext | null = null;

export function appContext(): AppContext {
  if (!current && ACTIVE_DIALECT === 'pg') {
    throw new Error(
      'The Postgres database opens during startup migrations, which have not run yet'
    );
  }
  current ??= createAppContext(getDb().$client);
  return current;
}

export function installAppContext(context: AppContext): void {
  if (CONFIG.env !== 'test') throw new Error('installAppContext is only for tests');
  current = context;
}

export function useAppContext(context: AppContext): void {
  if (current && CONFIG.env !== 'test') throw new Error('The database is already open');
  current = context;
}

export function repos(): AppContext['repos'] {
  return appContext().repos;
}
