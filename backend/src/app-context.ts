import { AnalyticsInsightsRepository } from './api/analytics/insights';
import { AnalyticsQueryRepository } from './api/analytics/query-repository';
import { AnalyticsRepository } from './api/analytics/repository';
import { AuthProviderRepository } from './api/auth/auth-provider-repository';
import { createLucia } from './api/auth/lucia';
import { CommunityStatsRepository } from './api/community/repository';
import { FinancingRepository } from './api/financing/repository';
import { OdometerRepository } from './api/odometer/repository';
import { PushSubscriptionRepository } from './api/push/repository';
import { ReminderRepository } from './api/reminders/repository';
import { TripRepository } from './api/trips/repository';
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
      financing: new FinancingRepository(db),
      odometer: new OdometerRepository(db),
      pushSubscriptions: new PushSubscriptionRepository(db),
      reminders: new ReminderRepository(db),
      trips: new TripRepository(db),
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
