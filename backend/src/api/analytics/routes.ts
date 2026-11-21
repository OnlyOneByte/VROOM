import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../middleware';
import { calendarParts, zonedCalendar } from '../../utils/analytics-charts';
import { requireVehicleOwnerScope } from '../../utils/sharing';
import { isValidTimeZone } from '../../utils/time-zone';
import { zValidator } from '../../utils/validation';
import {
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
import { analyticsRepository } from './repository';

const routes = new Hono();

const timeZone = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional();
const timeZoneQuerySchema = z.object({ timeZone });

const fuelEfficiencyQuerySchema = z.object({
  vehicleId: z.string().optional(),
});

const MIN_YEAR = 1900;
const MAX_EPOCH_SECONDS = Date.UTC(2101, 0, 1) / 1000;

const epochSeconds = z.coerce
  .number()
  .int()
  .positive()
  .max(MAX_EPOCH_SECONDS, 'Dates are epoch seconds, not milliseconds');

const year = z.coerce
  .number()
  .int()
  .min(MIN_YEAR, `Year must be ${MIN_YEAR} or later`)
  .refine((y) => y <= new Date().getUTCFullYear() + 1, 'Year is too far in the future')
  .optional();

function startNotAfterEnd(range: { startDate: number; endDate: number }): boolean {
  return range.startDate <= range.endDate;
}

const RANGE_ORDER_ERROR = { message: 'startDate must not be after endDate', path: ['endDate'] };

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

const dateRangeQuerySchema = z.object(dateRangeFields).refine(startNotAfterEnd, RANGE_ORDER_ERROR);

const yearToDateQuerySchema = z
  .object({ ...dateRangeFields, ytdStart: epochSeconds.optional() })
  .refine(startNotAfterEnd, RANGE_ORDER_ERROR);

const dateRangeVehicleQuerySchema = z
  .object({ ...dateRangeFields, vehicleId: z.string().optional() })
  .refine(startNotAfterEnd, RANGE_ORDER_ERROR);

const dateRangeRequiredVehicleQuerySchema = z
  .object({ ...dateRangeFields, vehicleId: z.string() })
  .refine(startNotAfterEnd, RANGE_ORDER_ERROR);

const yearVehicleQuerySchema = z.object({
  year,
  vehicleId: z.string(),
  timeZone,
});

routes.use('*', requireAuth);

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

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

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

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

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
  const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
  const data = await analyticsRepository.getVehicleHealth(scopeId, vehicleId, timeZone);
  return c.json({ success: true, data });
});

routes.get('/vehicle-tco', zValidator('query', yearVehicleQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, year, timeZone } = c.req.valid('query');
  const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
  const data = await analyticsRepository.getVehicleTCO(scopeId, vehicleId, year, timeZone);
  return c.json({ success: true, data: vehicleTcoToApi(data) });
});

routes.get(
  '/vehicle-expenses',
  zValidator('query', dateRangeRequiredVehicleQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId, startDate, endDate, timeZone } = c.req.valid('query');
    const scopeId = await requireVehicleOwnerScope(vehicleId, user.id, 'read');
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

  const scopeId = vehicleId ? await requireVehicleOwnerScope(vehicleId, user.id, 'read') : user.id;

  const fuelEfficiencyTrend = await analyticsRepository.getFuelEfficiencyTrend(scopeId, vehicleId);

  return c.json({ success: true, data: { fuelEfficiencyTrend } });
});

export { routes };
