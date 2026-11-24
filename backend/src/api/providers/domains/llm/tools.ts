// userId always comes from the session, never from model arguments.

import { z } from 'zod';
import { calendarParts, zonedCalendar } from '../../../../utils/analytics-charts';
import {
  expenseSummaryToApi,
  reminderWithVehiclesToApi,
  vehicleRowToApi,
} from '../../../../utils/money';
import { requireVehicleAccess, resolveExpenseReadScope } from '../../../../utils/vehicle-access';
import {
  analyticsSummaryToApi,
  crossVehicleToApi,
  financingToApi as financingAnalyticsToApi,
  fuelStatsToApi,
  insuranceToApi,
} from '../../../analytics/api-transform';
import { analyticsRepository } from '../../../analytics/repository';
import { expenseRepository } from '../../../expenses/repository';
import { reminderRepository } from '../../../reminders/repository';
import { vehicleRepository } from '../../../vehicles/repository';
import type { ToolDefinition } from './llm-provider';

export const RANGE_VALUES = ['30d', '90d', 'ytd', '12mo', 'all'] as const;
type RangeValue = (typeof RANGE_VALUES)[number];

const DAY_SECONDS = 86_400;

export function resolveRange(
  range: RangeValue,
  nowMs: number,
  timeZone?: string
): { start: number; end: number } {
  const end = Math.floor(nowMs / 1000);
  switch (range) {
    case '30d':
      return { start: end - 30 * DAY_SECONDS, end };
    case '90d':
      return { start: end - 90 * DAY_SECONDS, end };
    case '12mo':
      return { start: end - 365 * DAY_SECONDS, end };
    case 'ytd': {
      const calendar = zonedCalendar(timeZone);
      const jan1 = calendar.yearStart(calendarParts(new Date(nowMs), calendar).year);
      return { start: Math.floor(jan1.getTime() / 1000), end };
    }
    case 'all':
      return { start: 0, end };
  }
}

function toExpensePeriod(range: RangeValue): '7d' | '30d' | '90d' | '1y' | 'all' {
  switch (range) {
    case '30d':
      return '30d';
    case '90d':
      return '90d';
    case '12mo':
    case 'ytd':
      return '1y';
    case 'all':
      return 'all';
  }
}

const rangeSchema = z.enum(RANGE_VALUES);
const emptyArgs = z.object({}).strip();
const rangeArgs = z.object({ range: rangeSchema }).strip();
const rangeVehicleArgs = z
  .object({ range: rangeSchema, vehicleId: z.string().min(1).optional() })
  .strip();

function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
}

interface AssistantTool<A = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  parameters: Record<string, unknown>;
  run(args: A, userId: string, nowMs: number, timeZone?: string): Promise<unknown>;
}

interface AssistantToolSpec<A, R> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  read(args: A, userId: string, nowMs: number, timeZone?: string): Promise<R>;
  toApi(data: R): unknown;
}

function defineTool<A, R>(spec: AssistantToolSpec<A, R>): AssistantTool<A> {
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    parameters: toToolParameters(spec.schema),
    run: async (args, userId, nowMs, timeZone) =>
      spec.toApi(await spec.read(args, userId, nowMs, timeZone)),
  };
}

// Without a vehicleId, scope to the user's own vehicles: shared ones would leak another user's name to the LLM provider.
async function resolveScope(vehicleId: string | undefined, userId: string): Promise<string> {
  if (!vehicleId) return userId;
  return (await requireVehicleAccess(vehicleId, userId, 'read')).ownerId;
}

const TOOL_LIST: AssistantTool[] = [
  defineTool({
    name: 'listVehicles',
    description:
      "List the user's vehicles (make, model, year, nickname) with any financing summary.",
    schema: emptyArgs,
    read: async (_args, userId) => vehicleRepository.findByUserId(userId),
    toApi: (rows) => rows.map(vehicleRowToApi),
  }),
  defineTool({
    name: 'getExpenseSummary',
    description:
      'Total spend, expense count, monthly average, and a per-category breakdown over a time range. ' +
      'Optionally scoped to one vehicle.',
    schema: rangeVehicleArgs,
    read: async (args, userId) => {
      return expenseRepository.getSummary({
        ...(await resolveExpenseReadScope(args.vehicleId, userId)),
        period: toExpensePeriod(args.range),
        ...(args.vehicleId ? { vehicleId: args.vehicleId } : {}),
      });
    },
    toApi: expenseSummaryToApi,
  }),
  defineTool({
    name: 'getFuelStats',
    description:
      'Fuel/efficiency statistics (MPG or mi/kWh, cost per mile, fill-up counts) over a time range. ' +
      'Optionally scoped to one vehicle.',
    schema: rangeVehicleArgs,
    read: async (args, userId, nowMs, timeZone) => {
      const scopeId = await resolveScope(args.vehicleId, userId);
      return analyticsRepository.getFuelStats(
        scopeId,
        resolveRange(args.range, nowMs, timeZone),
        args.vehicleId,
        timeZone
      );
    },
    toApi: fuelStatsToApi,
  }),
  defineTool({
    name: 'getAnalyticsSummary',
    description:
      'A combined quick-stats + fuel-stats overview across all vehicles over a time range.',
    schema: rangeArgs,
    read: async (args, userId, nowMs, timeZone) =>
      analyticsRepository.getSummary(
        userId,
        resolveRange(args.range, nowMs, timeZone),
        resolveRange('ytd', nowMs, timeZone).start,
        timeZone
      ),
    toApi: analyticsSummaryToApi,
  }),
  defineTool({
    name: 'getCrossVehicle',
    description:
      'Compare all vehicles head-to-head over a time range (spend, efficiency, cost-per-mile per vehicle).',
    schema: rangeArgs,
    read: async (args, userId, nowMs, timeZone) =>
      analyticsRepository.getCrossVehicle(
        userId,
        resolveRange(args.range, nowMs, timeZone),
        timeZone
      ),
    toApi: crossVehicleToApi,
  }),
  defineTool({
    name: 'getFinancingState',
    description: "The user's loan/lease state per vehicle: balances, payments, payoff progress.",
    schema: emptyArgs,
    read: async (_args, userId, _nowMs, timeZone) =>
      analyticsRepository.getFinancing(userId, timeZone),
    toApi: financingAnalyticsToApi,
  }),
  defineTool({
    name: 'getInsuranceState',
    description: "The user's insurance policies/terms per vehicle and upcoming expirations.",
    schema: emptyArgs,
    read: async (_args, userId, _nowMs, timeZone) =>
      analyticsRepository.getInsurance(userId, timeZone),
    toApi: insuranceToApi,
  }),
  defineTool({
    name: 'getUpcomingReminders',
    description:
      'Active reminders (service intervals, registration, etc.) and when they are next due.',
    schema: emptyArgs,
    read: async (_args, userId) => reminderRepository.findByUserId(userId, { isActive: true }),
    toApi: (rows) => rows.map(reminderWithVehiclesToApi),
  }),
];

export const ASSISTANT_TOOLS: Readonly<Record<string, AssistantTool>> = Object.freeze(
  Object.fromEntries(TOOL_LIST.map((t) => [t.name, t]))
);

export function toolDefinitions(): ToolDefinition[] {
  return TOOL_LIST.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
