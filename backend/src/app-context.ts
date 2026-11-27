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
import { openAsyncDatabase } from './db/async-sqlite';
import { type AppDatabase, getDb } from './db/connection';

export function createAppContext(db: AppDatabase) {
  const analyticsQuery = new AnalyticsQueryRepository(db);
  const asyncDb = openAsyncDatabase(db.$client).db;
  return {
    db,
    asyncDb,
    lucia: createLucia(asyncDb),
    repos: {
      analytics: new AnalyticsRepository(db),
      analyticsInsights: new AnalyticsInsightsRepository(db, analyticsQuery),
      analyticsQuery,
      authProviders: new AuthProviderRepository(asyncDb),
      communityStats: new CommunityStatsRepository(db),
      expenses: new ExpenseRepository(asyncDb),
      financing: new FinancingRepository(asyncDb),
      insuranceClaims: new InsuranceClaimRepository(asyncDb),
      insurancePolicies: new InsurancePolicyRepository(db),
      odometer: new OdometerRepository(asyncDb),
      photoRefs: new PhotoRefRepository(asyncDb),
      photos: new PhotoRepository(db),
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
  current ??= createAppContext(getDb());
  return current;
}

export function repos(): AppContext['repos'] {
  return appContext().repos;
}
