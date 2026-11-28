import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import { expenses, vehicles } from '../../db/schema';
import { hiddenFinancialsScope } from '../../utils/vehicle-access';
import type { Period } from './distance';
import { listDrivers } from './repository';
import { driverStats } from './stats';

export const GROUP_CATEGORIES = {
  running: ['fuel', 'maintenance', 'misc'],
  ownership: ['financial', 'regulatory'],
} as const;

type Group = keyof typeof GROUP_CATEGORIES;

const payer = z.strictObject({ kind: z.literal('payer') });
const fixed = z
  .strictObject({
    kind: z.literal('fixed'),
    shares: z.record(z.string().min(1).max(64), z.number().min(0).max(100)),
  })
  .refine((r) => Math.abs(Object.values(r.shares).reduce((a, b) => a + b, 0) - 100) < 0.01, {
    message: 'Fixed shares must add up to 100%',
    path: ['shares'],
  });

export const rulesSchema = z.strictObject({
  running: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('distance') }),
    z.strictObject({ kind: z.literal('equal') }),
    payer,
    fixed,
  ]),
  ownership: z.discriminatedUnion('kind', [payer, fixed]),
});

export type SplitRules = z.infer<typeof rulesSchema>;
export type GroupRule = SplitRules[Group];

export const DEFAULT_RULES: SplitRules = {
  running: { kind: 'distance' },
  ownership: { kind: 'payer' },
};

export async function readRules(db: AsyncAppDatabase, vehicleId: string): Promise<SplitRules> {
  const row = await db
    .select({ rules: vehicles.carShareRules })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .then(firstRow);
  const parsed = rulesSchema.safeParse(row?.rules);
  return parsed.success ? parsed.data : DEFAULT_RULES;
}

export function rulesFor(rules: SplitRules, everyone: boolean, ownDriver: string | null) {
  if (everyone) return rules;
  const own = <R extends GroupRule>(rule: R): R =>
    rule.kind === 'fixed'
      ? {
          ...rule,
          shares: Object.fromEntries(
            Object.entries(rule.shares).filter(([id]) => id === ownDriver)
          ),
        }
      : rule;
  return { running: own(rules.running), ownership: own(rules.ownership) };
}

export async function writeRules(
  db: AsyncAppDatabase,
  vehicleId: string,
  rules: SplitRules
): Promise<void> {
  await db
    .update(vehicles)
    .set({ carShareRules: rules, updatedAt: new Date() })
    .where(eq(vehicles.id, vehicleId));
}

const UNASSIGNED = '';

export function allocate(total: number, weights: Map<string, number>): Map<string, number> {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (sum <= 0 || total === 0) return out;
  const sign = Math.sign(total);
  const exact = [...weights].map(([key, w]) => [key, (Math.abs(total) * w) / sum] as const);
  let left = Math.abs(total);
  for (const [key, value] of exact) {
    out.set(key, Math.floor(value));
    left -= Math.floor(value);
  }
  const byRemainder = [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1));
  for (const [key] of byRemainder.slice(0, left)) out.set(key, (out.get(key) ?? 0) + 1);
  for (const [key, value] of out) out.set(key, value * sign);
  return out;
}

export interface GroupInput {
  total: number;
  paidBy: Map<string | null, number>;
  distance: Map<string, number>;
  unattributed: number;
  active: string[];
}

function weightsFor(rule: GroupRule, input: GroupInput): Map<string, number> {
  if (rule.kind === 'distance') {
    return new Map([...input.distance, [UNASSIGNED, input.unattributed]]);
  }
  if (rule.kind === 'equal') return new Map(input.active.map((id) => [id, 1]));
  if (rule.kind === 'fixed') return new Map(Object.entries(rule.shares));
  return new Map();
}

export function splitGroup(
  rule: GroupRule,
  input: GroupInput
): { owed: Map<string, number>; unassigned: number } {
  if (rule.kind === 'payer') {
    const owed = new Map(
      [...input.paidBy].flatMap(([id, cents]) => (id === null ? [] : [[id, cents] as const]))
    );
    return { owed, unassigned: 0 };
  }
  const withPayer = input.total - (input.paidBy.get(null) ?? 0);
  const shares = allocate(withPayer, weightsFor(rule, input));
  const allocated = [...shares.values()].reduce((a, b) => a + b, 0);
  const owed = new Map([...shares].filter(([id]) => id !== UNASSIGNED));
  const unassigned = (shares.get(UNASSIGNED) ?? 0) + (withPayer - allocated);
  return { owed, unassigned };
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export function settle(balances: Map<string, number>): Transfer[] {
  const owes = [...balances].filter(([, b]) => b > 0).map(([id, b]) => ({ id, left: b }));
  const gets = [...balances].filter(([, b]) => b < 0).map(([id, b]) => ({ id, left: -b }));
  owes.sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  gets.sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < gets.length) {
    const debtor = owes[i];
    const creditor = gets[j];
    if (!debtor || !creditor) break;
    const amount = Math.min(debtor.left, creditor.left);
    transfers.push({ from: debtor.id, to: creditor.id, amount });
    debtor.left -= amount;
    creditor.left -= amount;
    if (debtor.left === 0) i++;
    if (creditor.left === 0) j++;
  }
  return transfers;
}

export interface BalanceOptions {
  period: Period;
  hideFinancials: boolean;
}

function spending(db: AsyncAppDatabase, vehicleId: string, options: BalanceOptions) {
  return db
    .select({
      category: expenses.category,
      cents: expenses.expenseAmount,
      payer: expenses.paidByDriverId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.vehicleId, vehicleId),
        gte(expenses.date, new Date(options.period.from)),
        lte(expenses.date, new Date(options.period.to)),
        inArray(expenses.category, [...GROUP_CATEGORIES.running, ...GROUP_CATEGORIES.ownership]),
        options.hideFinancials ? hiddenFinancialsScope() : undefined
      )
    );
}

export async function computeBalances(
  db: AsyncAppDatabase,
  vehicleId: string,
  options: BalanceOptions
) {
  const rules = await readRules(db, vehicleId);
  const drivers = await listDrivers(db, vehicleId);
  const stats = await driverStats(db, vehicleId, {
    period: options.period,
    withEstimates: true,
    viewerUserId: '',
    everyone: true,
    includeCarCosts: false,
    scale: 1,
  });
  const distance = new Map(stats.drivers.map((d) => [d.driverId, d.distance.total]));
  const rows = await spending(db, vehicleId, options);
  const owed = new Map<string, number>();
  const paid = new Map<string, number>();
  let unassigned = 0;
  let unpaid = 0;
  let total = 0;
  for (const group of Object.keys(GROUP_CATEGORIES) as Group[]) {
    const categories: readonly string[] = GROUP_CATEGORIES[group];
    const inGroup = rows.filter((r) => categories.includes(r.category));
    const paidBy = new Map<string | null, number>();
    for (const r of inGroup) paidBy.set(r.payer, (paidBy.get(r.payer) ?? 0) + r.cents);
    const groupTotal = inGroup.reduce((sum, r) => sum + r.cents, 0);
    const result = splitGroup(rules[group], {
      total: groupTotal,
      paidBy,
      distance,
      unattributed: stats.distance?.unattributed ?? 0,
      active: drivers.filter((d) => !d.archived).map((d) => d.id),
    });
    for (const [id, cents] of result.owed) owed.set(id, (owed.get(id) ?? 0) + cents);
    for (const [id, cents] of paidBy) {
      if (id === null) unpaid += cents;
      else paid.set(id, (paid.get(id) ?? 0) + cents);
    }
    unassigned += result.unassigned;
    total += groupTotal;
  }
  const ids = new Set([...owed.keys(), ...paid.keys()]);
  const balances = new Map([...ids].map((id) => [id, (owed.get(id) ?? 0) - (paid.get(id) ?? 0)]));
  return {
    rules,
    drivers,
    owed,
    paid,
    balances,
    unassigned,
    unpaid,
    total,
    transfers: settle(balances),
  };
}

type Balances = Awaited<ReturnType<typeof computeBalances>>;

export function balancesView(
  result: Balances,
  options: { everyone: boolean; ownDriver: string | null; scale: number }
) {
  const money = (cents: number) => cents / options.scale;
  const byId = new Map(result.drivers.map((d) => [d.id, d]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Driver';
  const sees = (id: string) => options.everyone || id === options.ownDriver;
  const managers = <T>(value: T) => (options.everyone ? value : null);
  return {
    scope: options.everyone ? ('everyone' as const) : ('own' as const),
    rules: rulesFor(result.rules, options.everyone, options.ownDriver),
    drivers: [...result.balances]
      .filter(([id]) => sees(id))
      .map(([id, balance]) => ({
        driverId: id,
        name: nameOf(id),
        color: byId.get(id)?.color ?? null,
        guest: !byId.get(id)?.userId,
        you: id === options.ownDriver,
        owed: money(result.owed.get(id) ?? 0),
        paid: money(result.paid.get(id) ?? 0),
        balance: money(balance),
      })),
    transfers: result.transfers
      .filter((t) => sees(t.from) || sees(t.to))
      .map((t) => ({
        fromDriverId: t.from,
        fromName: nameOf(t.from),
        toDriverId: t.to,
        toName: nameOf(t.to),
        amount: money(t.amount),
      })),
    total: managers(money(result.total)),
    unassigned: managers(money(result.unassigned)),
    unpaid: managers(money(result.unpaid)),
  };
}
