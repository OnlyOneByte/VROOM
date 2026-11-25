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
import { type AppDatabase, getDb } from './db/connection';

export function createAppContext(db: AppDatabase) {
  const analyticsQuery = new AnalyticsQueryRepository(db);
  return {
    db,
    lucia: createLucia(db),
    repos: {
      analytics: new AnalyticsRepository(db),
      analyticsInsights: new AnalyticsInsightsRepository(db, analyticsQuery),
      analyticsQuery,
      authProviders: new AuthProviderRepository(db),
      communityStats: new CommunityStatsRepository(db),
      expenses: new ExpenseRepository(db),
      financing: new FinancingRepository(db),
      insuranceClaims: new InsuranceClaimRepository(db),
      insurancePolicies: new InsurancePolicyRepository(db),
      odometer: new OdometerRepository(db),
      photoRefs: new PhotoRefRepository(db),
      photos: new PhotoRepository(db),
      preferences: new PreferencesRepository(db),
      pushSubscriptions: new PushSubscriptionRepository(db),
      reminders: new ReminderRepository(db),
      syncState: new SyncStateRepository(db),
      trips: new TripRepository(db),
      vehicles: new VehicleRepository(db),
      vehicleShares: new VehicleShareRepository(db),
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
