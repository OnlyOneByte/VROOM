import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { EXPENSE_CATEGORIES } from '../../db/types';
import { requireAuth } from '../../middleware';
import { calendarParts, zonedCalendar } from '../../utils/analytics-charts';
import { isValidTimeZone } from '../../utils/time-zone';
import { zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import {
  analyticsQueryToApi,
  analyticsSummaryToApi,
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
  analyticsQueryRepository,
  isValidQueryCombination,
  QUERY_COMPARES,
  QUERY_ENERGIES,
  QUERY_GROUP_BYS,
  QUERY_INCLUDES,
  QUERY_INTERVALS,
  QUERY_METRICS,
} from './query-repository';
import { analyticsRepository } from './repository';

const routes = new Hono();

const timeZone = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional();
const timeZoneQuerySchema = z.object({ timeZone });

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

const dateRangeQuerySchema = z.object(dateRangeFields).refine(startBeforeEnd, RANGE_ORDER_ERROR);

const yearToDateQuerySchema = z
  .object({ ...dateRangeFields, ytdStart: epochSeconds.optional() })
  .refine(startBeforeEnd, RANGE_ORDER_ERROR);

const dateRangeVehicleQuerySchema = z
  .object({ ...dateRangeFields, vehicleId: z.string().optional() })
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
  })
  .refine((q) => q.start == null || q.end == null || q.start < q.end, {
    message: 'start must be before end',
    path: ['end'],
  })
  .refine((q) => isValidQueryCombination(q.metric, q.groupBy), {
    message: 'This metric cannot be grouped that way',
    path: ['groupBy'],
  });

routes.use('*', requireAuth);

routes.get('/query', zValidator('query', analyticsQuerySchema), async (c) => {
  const user = c.get('user');
  const data = await analyticsQueryRepository.query(user.id, c.req.valid('query'));
  return c.json({ success: true, data: analyticsQueryToApi(data) });
});

routes.get('/summary', zValidator('query', yearToDateQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, ytdStart, timeZone } = c.req.valid('query');
  const data = await analyticsRepository.getSummary(
    user.id,
    { start: startDate, end: endDate },
    ytdStart,
    timeZone
  );
  return c.json({ success: true, data: analyticsSummaryToApi(data) });
});

routes.get('/quick-stats', zValidator('query', yearToDateQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, ytdStart, timeZone } = c.req.valid('query');
  const data = await analyticsRepository.getQuickStats(
    user.id,
    { start: startDate, end: endDate },
    ytdStart,
    timeZone
  );
  return c.json({ success: true, data: quickStatsToApi(data) });
});

routes.get('/fuel-stats', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId, timeZone } = c.req.valid('query');

  const scopeId = vehicleId
    ? (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId
    : user.id;

  const data = await analyticsRepository.getFuelStats(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId,
    timeZone
  );
  return c.json({ success: true, data: fuelStatsToApi(data) });
});

routes.get('/cross-vehicle', zValidator('query', dateRangeQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, timeZone } = c.req.valid('query');
  const data = await analyticsRepository.getCrossVehicle(
    user.id,
    { start: startDate, end: endDate },
    timeZone
  );
  return c.json({ success: true, data: crossVehicleToApi(data) });
});

routes.get('/financing', zValidator('query', timeZoneQuerySchema), async (c) => {
  const user = c.get('user');
  const { timeZone } = c.req.valid('query');
  const data = await analyticsRepository.getFinancing(user.id, timeZone);
  return c.json({ success: true, data: financingToApi(data) });
});

routes.get('/insurance', zValidator('query', timeZoneQuerySchema), async (c) => {
  const user = c.get('user');
  const { timeZone } = c.req.valid('query');
  const data = await analyticsRepository.getInsurance(user.id, timeZone);
  return c.json({ success: true, data: insuranceToApi(data) });
});

routes.get('/fuel-advanced', zValidator('query', dateRangeVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { startDate, endDate, vehicleId, timeZone } = c.req.valid('query');

  const scopeId = vehicleId
    ? (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId
    : user.id;

  const data = await analyticsRepository.getFuelAdvanced(
    scopeId,
    { start: startDate, end: endDate },
    vehicleId,
    timeZone
  );
  return c.json({ success: true, data: fuelAdvancedToApi(data) });
});

routes.get('/vehicle-health', zValidator('query', vehicleIdQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, timeZone } = c.req.valid('query');
  const scopeId = (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId;
  const data = await analyticsRepository.getVehicleHealth(scopeId, vehicleId, timeZone);
  return c.json({ success: true, data });
});

routes.get('/vehicle-tco', zValidator('query', yearVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, year, timeZone } = c.req.valid('query');
  const scopeId = (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId;
  const data = await analyticsRepository.getVehicleTCO(scopeId, vehicleId, year, timeZone);
  return c.json({ success: true, data: vehicleTcoToApi(data) });
});

routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate, timeZone } = c.req.valid('query');
    const scopeId = (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId;
    const data = await analyticsRepository.getVehicleExpenses(
      scopeId,
      vehicleId,
      { start: startDate, end: endDate },
      timeZone
    );
    return c.json({ success: true, data: vehicleExpensesToApi(data) });
  }
);

routes.get('/year-end', zValidator('query', yearQuerySchema), async (c) => {
  const user = c.get('user');
  const { year, timeZone } = c.req.valid('query');
  const currentYear = year ?? calendarParts(new Date(), zonedCalendar(timeZone)).year;
  const data = await analyticsRepository.getYearEnd(user.id, currentYear, timeZone);
  return c.json({ success: true, data: yearEndToApi(data) });
});

routes.get('/fuel-efficiency', zValidator('query', fuelEfficiencyQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');

  const scopeId = vehicleId
    ? (await requireVehicleAccess(vehicleId, user.id, 'read')).ownerId
    : user.id;

  const fuelEfficiencyTrend = await analyticsRepository.getFuelEfficiencyTrend(scopeId, vehicleId);

  return c.json({ success: true, data: { fuelEfficiencyTrend } });
});

export { routes };
