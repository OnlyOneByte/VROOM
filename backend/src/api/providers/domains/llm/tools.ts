/**
 * The READ-ONLY tool allowlist for the LLM assistant (llm-assistant T2) — the load-bearing safety core.
 *
 * The assistant answers questions over the user's OWN car data by calling these tools; the model NEVER
 * touches the DB directly. Every entry is:
 *  - READ-ONLY — no tool mutates anything (v1 is read-only by construction, design §8.1: there is no
 *  model-driven write path to secure);
 *  - userId-SCOPED — `run(args, userId)` takes the userId from the AUTHENTICATED SESSION (the orchestrator
 *  passes `c.get('user').id`), NEVER from a model-supplied argument. No tool arg is a userId/ownerId, so
 *  the model can only ever read the requesting user's own rows (ARCC confused-deputy guard);
 *  - typed + bounded — `args` is a Zod schema; the orchestrator parses the model's raw JSON args through
 *  it BEFORE calling `run`, and passes a typed OBJECT to the existing repo (ARCC AIQi: build queries as
 *  objects, never concatenate model text). An out-of-set `range`/bad arg is rejected, not coerced;
 *  - DOLLAR-denominated — every tool pairs its repository read with the SAME cents→dollars display-edge
 *  transform the matching HTTP route applies (see `defineTool`). Money is stored and summed in integer
 *  cents, and the model is told the amounts are already in the user's currency, so a tool that returned
 *  raw cents would make the assistant state every figure 100x too large.
 * A model-supplied `vehicleId` is re-checked via `requireVehicleRead(vehicleId, userId)` (throws
 * NotFoundError on no-access — existence-hiding) so it can never widen scope to another user's vehicle.
 *
 * The tool list itself is fork D4 (it may be trimmed or extended); the LAYER + its scope discipline are
 * fork-free and foundational — T2 ships them so T4's orchestrator has a validated, safe surface to call.
 */

import { z } from 'zod';
import {
  expenseSummaryToApi,
  reminderWithVehiclesToApi,
  vehicleRowToApi,
} from '../../../../utils/money';
import { requireVehicleRead, resolveVehicleOwnerId } from '../../../../utils/sharing';
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

/**
 * The allow-listed time windows the model may request. A bounded ENUM (never a free date string) so the
 * model cannot inject and the window is always sane. Mapped to a concrete {start,end} (unix SECONDS — the
 * analyticsRepository contract) at call time. `expenseRepository.getSummary` has its OWN period enum, so
 * `toExpensePeriod` maps onto that.
 */
export const RANGE_VALUES = ['30d', '90d', 'ytd', '12mo', 'all'] as const;
export type RangeValue = (typeof RANGE_VALUES)[number];

const DAY_SECONDS = 86_400;

/** Resolve a range enum to {start,end} in unix SECONDS, relative to `nowMs` (injectable for tests). */
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

/** Map the assistant range enum onto expenseRepository's own period enum (closest bucket). */
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

/**
 * One read-only tool: a name + a human description (sent to the model so it knows when to call it) + a
 * Zod arg schema (the orchestrator validates the model's raw args against this) + `run(args, userId)`
 * (executed userId-scoped). `run` returns a plain JSON-able object fed back to the model as a tool result.
 */
export interface AssistantTool<A = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  run(args: A, userId: string, nowMs: number): Promise<unknown>;
}

/**
 * How ONE tool is declared: the userId-scoped repository read PLUS the display-edge transform that
 * projects its result into the API's dollar contract. The split is what makes that contract structural
 * rather than remembered — `toApi` is REQUIRED, so a tool added later cannot hand the model raw integer
 * cents by forgetting a conversion, and the transform is the very function the matching HTTP route
 * applies (never a second copy of the maths, which is how the two surfaces diverge).
 */
interface AssistantToolSpec<A, R> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  /** Read the data userId-scoped. Money comes back in integer CENTS (the repository contract). */
  read(args: A, userId: string, nowMs: number): Promise<R>;
  /** The SAME cents→dollars mapper the HTTP route for this shape uses. */
  toApi(data: R): unknown;
}

/** Compose a spec into a tool: `run` is `read` followed by the mandatory display-edge transform. */
function defineTool<A, R>(spec: AssistantToolSpec<A, R>): AssistantTool<A> {
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    run: async (args, userId, nowMs) => spec.toApi(await spec.read(args, userId, nowMs)),
  };
}

/**
 * Validate a model-supplied vehicleId against the SESSION user — the confused-deputy guard. Returns the
 * scope id to query BY: the vehicle's OWNER, because a shared vehicle's expense/fuel rows are
 * owner-stamped, so scoping a per-vehicle question to the acting user would report zeros to a sharee for
 * data the API shows them. Throws NotFoundError when the user cannot read the vehicle (existence-hiding
 * — a stranger cannot tell "not yours" from "does not exist"). The vehicleId+ownerId pin means only THAT
 * vehicle's rows surface, never the owner's other vehicles. This mirrors the HTTP routes exactly
 * (expenses `/summary`, the per-vehicle analytics).
 *
 * `undefined` vehicleId → the acting user's own id. The fleet-wide tools are therefore acting-user-owned
 * and, like `GET /vehicles` without `include=shared`, never mention a vehicle shared TO the user: a
 * sharee reaches a shared vehicle by naming its id, not by it appearing in their fleet. Deliberate —
 * widening the fleet-wide surface would both double-count a co-owned fleet's totals and ship the other
 * user's display name to the configured LLM provider.
 */
async function resolveScope(vehicleId: string | undefined, userId: string): Promise<string> {
  if (!vehicleId) return userId;
  await requireVehicleRead(vehicleId, userId); // throws NotFoundError if the user cannot read it
  const ownerId = await resolveVehicleOwnerId(vehicleId);
  return ownerId ?? userId;
}

/**
 * The FIXED allowlist, keyed by tool name. Every value is read-only + userId-scoped (design §4 / D4). The
 * orchestrator (T4) looks a requested tool up here (rejecting an unknown name), validates the args via
 * `.schema`, and calls `.run(args, sessionUserId)`. NOTE: these return AGGREGATES/summaries, not raw-row
 * dumps (data-minimization, D4) — the FE/model gets totals + breakdowns, not every expense row.
 */
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
    read: async (args: z.infer<typeof rangeVehicleArgs>, userId) => {
      // A model-supplied vehicleId is scope-checked (confused-deputy guard) and resolved to the books
      // that own the vehicle's rows BEFORE it reaches the repo — see resolveScope.
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
    read: async (args: z.infer<typeof rangeVehicleArgs>, userId, nowMs) => {
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
    read: async (args: z.infer<typeof rangeArgs>, userId, nowMs) =>
      analyticsRepository.getSummary(userId, resolveRange(args.range, nowMs)),
    toApi: analyticsSummaryToApi,
  }),
  defineTool({
    name: 'getCrossVehicle',
    description:
      'Compare all vehicles head-to-head over a time range (spend, efficiency, cost-per-mile per vehicle).',
    schema: rangeArgs,
    read: async (args: z.infer<typeof rangeArgs>, userId, nowMs) =>
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

/** The allowlist as a name→tool map (the orchestrator's lookup). Frozen — the model cannot add to it. */
export const ASSISTANT_TOOLS: Readonly<Record<string, AssistantTool>> = Object.freeze(
  Object.fromEntries(TOOL_LIST.map((t) => [t.name, t]))
);

/** The tool DEFINITIONS sent to the model (name + description + JSON-schema of the args). */
export function toolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return TOOL_LIST.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema),
  }));
}

/**
 * Minimal Zod→JSON-Schema for the THREE arg shapes the allowlist uses (empty / {range} / {range,
 * vehicleId?}). A tiny hand-rolled mapper (not a dependency) keeps the surface auditable — the model only
 * ever sees these exact shapes, and the orchestrator re-validates with the real Zod schema regardless.
 */
function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const rangeProp = { type: 'string', enum: [...RANGE_VALUES] };
  if (schema === emptyArgs) {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  if (schema === rangeArgs) {
    return {
      type: 'object',
      properties: { range: rangeProp },
      required: ['range'],
      additionalProperties: false,
    };
  }
  // rangeVehicleArgs
  return {
    type: 'object',
    properties: { range: rangeProp, vehicleId: { type: 'string' } },
    required: ['range'],
    additionalProperties: false,
  };
}
