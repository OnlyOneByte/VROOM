/**
 * Read-only tools the assistant may call. Every tool takes its userId from the session, never from
 * model arguments, validates args with Zod, and returns dollar amounts through the same transform
 * the HTTP routes use. Raw cents would make the model state every figure 100x too large.
 */

import { z } from 'zod';
import {
  expenseSummaryToApi,
  reminderWithVehiclesToApi,
  vehicleRowToApi,
} from '../../../../utils/money';
import { requireVehicleOwnerScope } from '../../../../utils/sharing';
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
export type RangeValue = (typeof RANGE_VALUES)[number];

const DAY_SECONDS = 86_400;

export function resolveRange(range: RangeValue, nowMs: number): { start: number; end: number } {
  const end = Math.floor(nowMs / 1000);
  switch (range) {
    case '30d':
      return { start: end - 30 * DAY_SECONDS, end };
    case '90d':
      return { start: end - 90 * DAY_SECONDS, end };
    case '12mo':
      return { start: end - 365 * DAY_SECONDS, end };
    case 'ytd': {
      const d = new Date(nowMs);
      const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
      return { start: Math.floor(jan1 / 1000), end };
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

/** Derived from the Zod schema itself so the advertised arguments cannot drift from the validated ones. */
function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
}

export interface AssistantTool<A = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  /** JSON Schema advertised to the model for the same argument object. */
  parameters: Record<string, unknown>;
  run(args: A, userId: string, nowMs: number): Promise<unknown>;
}

interface AssistantToolSpec<A, R> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  /** Money comes back in integer cents. */
  read(args: A, userId: string, nowMs: number): Promise<R>;
  /** Must be the same mapper the matching HTTP route uses, so the two surfaces cannot diverge. */
  toApi(data: R): unknown;
}

function defineTool<A, R>(spec: AssistantToolSpec<A, R>): AssistantTool<A> {
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    parameters: toToolParameters(spec.schema),
    run: async (args, userId, nowMs) => spec.toApi(await spec.read(args, userId, nowMs)),
  };
}

/**
 * Scope for a model-supplied vehicleId: throws unless the session user can read the vehicle, then
 * returns the owner's id because shared-vehicle rows are owner-stamped. Without a vehicleId the scope
 * is the acting user's own fleet, which deliberately excludes vehicles shared to them: including them
 * would double-count co-owned totals and send the other user's name to the LLM provider.
 */
async function resolveScope(vehicleId: string | undefined, userId: string): Promise<string> {
  if (!vehicleId) return userId;
  return requireVehicleOwnerScope(vehicleId, userId, 'read');
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
      const scopeId = await resolveScope(args.vehicleId, userId);
      return expenseRepository.getSummary({
        userId: scopeId,
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
    read: async (args, userId, nowMs) => {
      const scopeId = await resolveScope(args.vehicleId, userId);
      return analyticsRepository.getFuelStats(
        scopeId,
        resolveRange(args.range, nowMs),
        args.vehicleId
      );
    },
    toApi: fuelStatsToApi,
  }),
  defineTool({
    name: 'getAnalyticsSummary',
    description:
      'A combined quick-stats + fuel-stats overview across all vehicles over a time range.',
    schema: rangeArgs,
    read: async (args, userId, nowMs) =>
      analyticsRepository.getSummary(userId, resolveRange(args.range, nowMs)),
    toApi: analyticsSummaryToApi,
  }),
  defineTool({
    name: 'getCrossVehicle',
    description:
      'Compare all vehicles head-to-head over a time range (spend, efficiency, cost-per-mile per vehicle).',
    schema: rangeArgs,
    read: async (args, userId, nowMs) =>
      analyticsRepository.getCrossVehicle(userId, resolveRange(args.range, nowMs)),
    toApi: crossVehicleToApi,
  }),
  defineTool({
    name: 'getFinancingState',
    description: "The user's loan/lease state per vehicle: balances, payments, payoff progress.",
    schema: emptyArgs,
    read: async (_args, userId) => analyticsRepository.getFinancing(userId),
    toApi: financingAnalyticsToApi,
  }),
  defineTool({
    name: 'getInsuranceState',
    description: "The user's insurance policies/terms per vehicle and upcoming expirations.",
    schema: emptyArgs,
    read: async (_args, userId) => analyticsRepository.getInsurance(userId),
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
