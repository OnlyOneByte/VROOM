import { Hono } from 'hono';
import { z } from 'zod';
import { repos } from '../../app-context';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { requireAuth } from '../../middleware';
import {
  authorize,
  ownAccount,
  type ResourceOf,
  vehicleOrOwnAccount,
} from '../../permissions/authorize';
import { calendarParts, zonedCalendar } from '../../utils/analytics-charts';
import { isValidTimeZone } from '../../utils/time-zone';
import { zValidator } from '../../utils/validation';
import {
  type ReadableVehicle,
  readableVehicles,
  requireVehicleAccess,
  seesFinancials,
} from '../../utils/vehicle-access';
import { QUERY_ANNOTATIONS } from './annotations';
import {
  analyticsQueryToApi,
  analyticsSummaryToApi,
  bucketItemsToApi,
  crossVehicleToApi,
  financingToApi,
  fuelAdvancedToApi,
  fuelStatsToApi,
  insuranceToApi,
  quickStatsToApi,
  vehicleExpensesToApi,
  vehicleTcoToApi,
  yearEndToApi,
} from './api-transform';
import {
  isValidQueryCombination,
  QUERY_COMPARES,
  QUERY_ENERGIES,
  QUERY_GROUP_BYS,
  QUERY_INCLUDES,
  QUERY_INTERVALS,
  QUERY_METRICS,
} from './query-repository';

const routes = new Hono();

const timeZone = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional();
const vehicleIds = z
  .string()
  .max(4000)
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().min(1).max(64)).max(50))
  .optional();
const timeZoneQuerySchema = z.object({ timeZone, vehicleIds });

const fuelEfficiencyQuerySchema = z.object({
  vehicleId: z.string().optional(),
});

const MIN_YEAR = CONFIG.validation.vehicle.minYear;

function latestAllowedYear(): number {
  return new Date().getUTCFullYear() + 1;
}

function endOfLatestAllowedYearSeconds(): number {
  return Date.UTC(latestAllowedYear() + 1, 0, 1) / 1000;
}

const SMALLEST_LIKELY_MILLISECONDS = 100_000_000_000;

const epochSeconds = z.coerce
  .number()
  .int()
  .positive()
  .refine(
    (seconds) => seconds < SMALLEST_LIKELY_MILLISECONDS,
    'Dates are epoch seconds, not milliseconds'
  )
  .refine(
    (seconds) =>
      seconds >= SMALLEST_LIKELY_MILLISECONDS || seconds <= endOfLatestAllowedYearSeconds(),
    'Dates can be at most the end of next year'
  );

const year = z.coerce
  .number()
  .int()
  .min(MIN_YEAR, `Year must be ${MIN_YEAR} or later`)
  .refine((y) => y <= latestAllowedYear(), 'Year is too far in the future')
  .optional();

function startBeforeEnd(range: { startDate: number; endDate: number }): boolean {
  return range.startDate < range.endDate;
}

const RANGE_ORDER_ERROR = { message: 'startDate must be before endDate', path: ['endDate'] };

const yearQuerySchema = z.object({
  year,
  timeZone,
});

const vehicleIdQuerySchema = z.object({
  vehicleId: z.string(),
  timeZone,
});

const dateRangeFields = {
  startDate: epochSeconds,
  endDate: epochSeconds,
  timeZone,
};

const dateRangeQuerySchema = z
  .object({ ...dateRangeFields, vehicleIds })
  .refine(startBeforeEnd, RANGE_ORDER_ERROR);

const yearToDateFields = { ...dateRangeFields, ytdStart: epochSeconds.optional() };

const yearToDateQuerySchema = z.object(yearToDateFields).refine(startBeforeEnd, RANGE_ORDER_ERROR);

const summaryQuerySchema = z
  .object({ ...yearToDateFields, vehicleIds })
  .refine(startBeforeEnd, RANGE_ORDER_ERROR);

const dateRangeVehicleQuerySchema = z
  .object({ ...dateRangeFields, vehicleId: z.string().optional(), vehicleIds })
  .refine(startBeforeEnd, RANGE_ORDER_ERROR);

const dateRangeRequiredVehicleQuerySchema = z
  .object({ ...dateRangeFields, vehicleId: z.string() })
  .refine(startBeforeEnd, RANGE_ORDER_ERROR);

const yearVehicleQuerySchema = z.object({
  year,
  vehicleId: z.string(),
  timeZone,
});

const csv = z
  .string()
  .max(4000)
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );

const jsonList = z
  .string()
  .max(8000)
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'keys must be a JSON array of strings' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().max(200)).max(200));

const insightsQuerySchema = z
  .object({
    start: epochSeconds,
    end: epochSeconds,
    vehicleIds: csv.pipe(z.array(z.string().min(1).max(64)).min(1).max(50)).optional(),
    timeZone,
  })
  .refine((q) => q.start < q.end, { message: 'start must be before end', path: ['end'] });

const analyticsQuerySchema = z
  .object({
    metric: z.enum(QUERY_METRICS),
    interval: z.enum(QUERY_INTERVALS).default('month'),
    groupBy: z.enum(QUERY_GROUP_BYS).default('none'),
    vehicleIds: csv.pipe(z.array(z.string().min(1).max(64)).min(1).max(50)).optional(),
    categories: csv.pipe(z.array(z.enum(EXPENSE_CATEGORIES)).min(1)).optional(),
    start: epochSeconds.optional(),
    end: epochSeconds.optional(),
    include: z.enum(QUERY_INCLUDES).default('running'),
    compare: z.enum(QUERY_COMPARES).default('none'),
    energy: z.enum(QUERY_ENERGIES).default('fuel'),
    timeZone,
    annotations: csv.pipe(z.array(z.enum(QUERY_ANNOTATIONS)).min(1)).optional(),
  })
  .refine((q) => q.start == null || q.end == null || q.start < q.end, {
    message: 'start must be before end',
    path: ['end'],
  })
  .refine((q) => isValidQueryCombination(q.metric, q.groupBy), {
    message: 'This metric cannot be grouped that way',
    path: ['groupBy'],
  });

const bucketItemsSchema = z
  .object({
    start: epochSeconds,
    end: epochSeconds,
    vehicleIds,
    categories: csv.pipe(z.array(z.enum(EXPENSE_CATEGORIES)).min(1)).optional(),
    include: z.enum(QUERY_INCLUDES).default('running'),
    metric: z.enum(QUERY_METRICS).default('cost'),
    energy: z.enum(QUERY_ENERGIES).default('fuel'),
    groupBy: z.enum(QUERY_GROUP_BYS).default('none'),
    keys: jsonList.optional(),
  })
  .refine((q) => q.start < q.end, { message: 'start must be before end', path: ['end'] })
  .refine((q) => isValidQueryCombination(q.metric, q.groupBy), {
    message: 'metric cannot be grouped this way',
    path: ['groupBy'],
  });

const fromVehicleQuery: ResourceOf = (c) => vehicleOrOwnAccount(c.req.query('vehicleId'), c);

async function queryScope(userId: string, vehicleIds?: string[]): Promise<ReadableVehicle[]> {
  if (vehicleIds && vehicleIds.length === 0) return [];
  const readable = await readableVehicles(userId, vehicleIds);
  const currencyOf = await repos().preferences.currencies([
    userId,
    ...readable.map((v) => v.ownerId),
  ]);
  return readable.filter((v) => currencyOf(v.ownerId) === currencyOf(userId));
}

routes.use('*', requireAuth);

routes.get(
  '/query/items',
  zValidator('query', bucketItemsSchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const query = c.req.valid('query');
    const scope = await queryScope(user.id, query.vehicleIds);
    const data = await repos().analyticsQuery.items(user.id, query, scope);
    return c.json({
      success: true,
      data: bucketItemsToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/insights',
  zValidator('query', insightsQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { start, end, vehicleIds: ids, timeZone: zone } = c.req.valid('query');
    const data = await repos().analyticsInsights.insights(user.id, {
      start,
      end,
      vehicleIds: ids,
      timeZone: zone ?? 'UTC',
    });
    return c.json({ success: true, data });
  }
);

routes.get(
  '/query',
  zValidator('query', analyticsQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const query = c.req.valid('query');
    const scope = await queryScope(user.id, query.vehicleIds);
    const data = await repos().analyticsQuery.query(user.id, query, scope);
    return c.json({
      success: true,
      data: analyticsQueryToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/summary',
  zValidator('query', summaryQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { startDate, endDate, ytdStart, timeZone, vehicleIds } = c.req.valid('query');
    const data = await repos().analytics.getSummary(
      user.id,
      { start: startDate, end: endDate },
      ytdStart,
      timeZone,
      vehicleIds,
      await queryScope(user.id, vehicleIds)
    );
    return c.json({
      success: true,
      data: analyticsSummaryToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/quick-stats',
  zValidator('query', yearToDateQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { startDate, endDate, ytdStart, timeZone } = c.req.valid('query');
    const data = await repos().analytics.getQuickStats(
      user.id,
      { start: startDate, end: endDate },
      ytdStart,
      timeZone
    );
    return c.json({
      success: true,
      data: quickStatsToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/fuel-stats',
  zValidator('query', dateRangeVehicleQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { startDate, endDate, vehicleId, vehicleIds, timeZone } = c.req.valid('query');

    const scopeId = vehicleId
      ? (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId
      : user.id;

    const data = await repos().analytics.getFuelStats(
      scopeId,
      { start: startDate, end: endDate },
      vehicleId ?? vehicleIds,
      timeZone
    );
    return c.json({
      success: true,
      data: fuelStatsToApi(data, await repos().preferences.moneyScale(scopeId)),
    });
  }
);

routes.get(
  '/cross-vehicle',
  zValidator('query', dateRangeQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { startDate, endDate, timeZone, vehicleIds } = c.req.valid('query');
    const data = await repos().analytics.getCrossVehicle(
      user.id,
      { start: startDate, end: endDate },
      timeZone,
      vehicleIds,
      await queryScope(user.id, vehicleIds)
    );
    return c.json({
      success: true,
      data: crossVehicleToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/financing',
  zValidator('query', timeZoneQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { timeZone, vehicleIds } = c.req.valid('query');
    const data = await repos().analytics.getFinancing(
      user.id,
      timeZone,
      vehicleIds,
      await queryScope(user.id, vehicleIds)
    );
    return c.json({
      success: true,
      data: financingToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/insurance',
  zValidator('query', timeZoneQuerySchema),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { timeZone, vehicleIds } = c.req.valid('query');
    const data = await repos().analytics.getInsurance(
      user.id,
      timeZone,
      vehicleIds,
      await queryScope(user.id, vehicleIds)
    );
    return c.json({
      success: true,
      data: insuranceToApi(data, await repos().preferences.moneyScale(user.id)),
    });
  }
);

routes.get(
  '/fuel-advanced',
  zValidator('query', dateRangeVehicleQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { startDate, endDate, vehicleId, vehicleIds, timeZone } = c.req.valid('query');

    const access = vehicleId ? await requireVehicleAccess(vehicleId, user.id, 'read') : null;
    const scopeId = access ? access.ownerId : user.id;

    const data = await repos().analytics.getFuelAdvanced(
      scopeId,
      { start: startDate, end: endDate },
      vehicleId ?? vehicleIds,
      timeZone,
      access ? !seesFinancials(access) : false
    );
    return c.json({
      success: true,
      data: fuelAdvancedToApi(data, await repos().preferences.moneyScale(scopeId)),
    });
  }
);

routes.get(
  '/vehicle-health',
  zValidator('query', vehicleIdQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, timeZone } = c.req.valid('query');
    const scopeId = (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId;
    const data = await repos().analytics.getVehicleHealth(scopeId, vehicleId, timeZone);
    return c.json({ success: true, data });
  }
);

routes.get(
  '/vehicle-tco',
  zValidator('query', yearVehicleQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, year, timeZone } = c.req.valid('query');
    const access = await requireVehicleAccess(vehicleId, user.id, 'read');
    const data = await repos().analytics.getVehicleTCO(
      access.ownerId,
      vehicleId,
      year,
      timeZone,
      !seesFinancials(access)
    );
    return c.json({
      success: true,
      data: vehicleTcoToApi(data, await repos().preferences.moneyScale(access.ownerId)),
    });
  }
);

routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate, timeZone } = c.req.valid('query');
    const access = await requireVehicleAccess(vehicleId, user.id, 'read');
    const data = await repos().analytics.getVehicleExpenses(
      access.ownerId,
      vehicleId,
      { start: startDate, end: endDate },
      timeZone,
      !seesFinancials(access)
    );
    return c.json({
      success: true,
      data: vehicleExpensesToApi(data, await repos().preferences.moneyScale(access.ownerId)),
    });
  }
);

routes.get('/year-end', zValidator('query', yearQuerySchema), authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const { year, timeZone } = c.req.valid('query');
  const currentYear = year ?? calendarParts(new Date(), zonedCalendar(timeZone)).year;
  const data = await repos().analytics.getYearEnd(user.id, currentYear, timeZone);
  return c.json({
    success: true,
    data: yearEndToApi(data, await repos().preferences.moneyScale(user.id)),
  });
});

routes.get(
  '/fuel-efficiency',
  zValidator('query', fuelEfficiencyQuerySchema),
  authorize(fromVehicleQuery),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('query');

    const scopeId = vehicleId
      ? (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId
      : user.id;

    const fuelEfficiencyTrend = await repos().analytics.getFuelEfficiencyTrend(scopeId, vehicleId);

    return c.json({ success: true, data: { fuelEfficiencyTrend } });
  }
);

export { routes };
