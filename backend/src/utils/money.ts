/**
 * Money helpers — the ONE source of truth for the dollars↔cents boundary (money-cents-migration).
 *
 * Money is stored + computed as integer CENTS everywhere internally (the 14 columns in design §1, flipped
 * by migration 0009). Dollars exist only at the two edges:
 *   - INPUT edge (client → DB): `dollarsToCents` — a Zod transform on every money input validator (T3).
 *   - DISPLAY edge (DB → client): `centsToDollars` — applied at the API response boundary (T6) so the
 *     frontend's existing dollar contract (`Expense.amount`, …) is UNCHANGED and no eyes-on FE work is needed.
 *
 * ROUND-before-int is mandatory on the way in: `12.34 * 100` is the binary float `1233.9999…`, so a bare
 * `| 0` / `Math.trunc` would store 1233 (a cent low). `Math.round` fixes it (same rule the 0009 migration
 * SQL uses: `CAST(ROUND(col*100) AS INTEGER)`).
 */

import { z } from 'zod';

/** Dollars (possibly fractional) → integer cents. `12.34 → 1234`. ROUND-before-int (binary-float safe). */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars. `1234 → 12.34`. The display edge; the inverse of `dollarsToCents`. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Return a SHALLOW COPY of a DB row with the named money columns converted cents→dollars (T6 display edge).
 * NULL/undefined money values pass through untouched (an absent optional amount stays absent). Used by the
 * per-entity `*ToApi` mappers at each route response boundary so the frontend's dollar contract is unchanged
 * while storage + internal math stay integer cents. Non-money fields are copied verbatim.
 *
 * Generic over the row shape; returns the same shape with the money fields still typed `number` (now dollars).
 */
export function centsFieldsToDollars<T extends Record<string, unknown>>(
  row: T,
  moneyFields: readonly (keyof T)[]
): T {
  const out = { ...row };
  for (const f of moneyFields) {
    const v = out[f];
    if (typeof v === 'number') {
      out[f] = centsToDollars(v) as T[keyof T];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-entity money-field lists (the SINGLE source of truth for which columns are cents) + the `*ToApi`
// response mappers (T6). Each maps ONE entity row (or null) cents→dollars at the route boundary. Apply at
// every `c.json` that returns a raw DB row for these entities; do NOT apply inside repositories/analytics
// (internal math must keep reading cents). The lists mirror design §1 — keep them in sync with schema.ts.
// ---------------------------------------------------------------------------

export const EXPENSE_MONEY_FIELDS = ['expenseAmount', 'groupTotal'] as const;
export const FINANCING_MONEY_FIELDS = [
  'originalAmount',
  'paymentAmount',
  'residualValue',
  'excessMileageFee',
] as const;
export const INSURANCE_TERM_MONEY_FIELDS = [
  'deductibleAmount',
  'coverageLimit',
  'totalCost',
  'monthlyCost',
  'paymentAmount',
] as const;
export const INSURANCE_CLAIM_MONEY_FIELDS = ['payoutAmount'] as const;
export const VEHICLE_MONEY_FIELDS = ['purchasePrice'] as const;
export const REMINDER_MONEY_FIELDS = ['expenseAmount'] as const;

/** Convert one row's money fields cents→dollars; null/undefined passes through (overloaded for ergonomics). */
function mapMoney<T extends Record<string, unknown>>(row: T, fields: readonly (keyof T)[]): T;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[]
): T | null | undefined;
function mapMoney<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fields: readonly (keyof T)[]
): T | null | undefined {
  return row == null ? row : centsFieldsToDollars(row, fields);
}

export const expenseToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, EXPENSE_MONEY_FIELDS as readonly (keyof T)[]);
export const financingToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, FINANCING_MONEY_FIELDS as readonly (keyof T)[]);
export const insuranceTermToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, INSURANCE_TERM_MONEY_FIELDS as readonly (keyof T)[]);
export const insuranceClaimToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, INSURANCE_CLAIM_MONEY_FIELDS as readonly (keyof T)[]);
export const vehicleToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, VEHICLE_MONEY_FIELDS as readonly (keyof T)[]);
export const reminderToApi = <T extends Record<string, unknown>>(row: T) =>
  mapMoney(row, REMINDER_MONEY_FIELDS as readonly (keyof T)[]);

/**
 * A financing API object's money fields cents→dollars, INCLUDING the derived `computedBalance`
 * (`withComputedBalance` adds it = originalAmount − Σ payments, all cents). `eligibleForPayoff` is
 * computed on the cents balance upstream, so it is copied through unchanged. ONE source of truth for the
 * financing display edge: the financing route returns this directly AND the vehicles route embeds it under
 * `vehicle.financing`, so the same field-set + computedBalance conversion was hand-rolled at both (C14) —
 * a divergence would show a different loan balance on the financing page vs the vehicle card (NORTH_STAR #2).
 * `computedBalance` is converted only when present + numeric (a raw create/replace row has no balance yet).
 */
export function financingWithBalanceToApi<T extends Record<string, unknown>>(row: T): T {
  const withMoney = financingToApi(row);
  return typeof withMoney.computedBalance === 'number'
    ? { ...withMoney, computedBalance: centsToDollars(withMoney.computedBalance) }
    : withMoney;
}

/**
 * A Zod schema that accepts a DOLLAR money amount from the client and transforms it to integer cents,
 * so the stored/validated value is already cents. Compose the numeric bound checks (`.positive()`,
 * `.min()`, `.max()`) on the BASE z.number() BEFORE the transform — they validate the dollar value the
 * client actually sent (e.g. `.positive()` rejects a negative dollar amount), then the transform scales.
 *
 * Pass a builder that takes the base `z.number()` and applies the dollar-domain constraints; this returns
 * that schema with the `.transform(dollarsToCents)` appended. Keeps every money validator a one-liner
 * with its own message/bounds while the cents conversion lives in ONE place.
 *
 *   moneyDollarsToCents((n) => n.positive('Amount must be positive'))           // required positive money
 *   moneyDollarsToCents((n) => n.min(0, 'Cannot be negative')).optional()       // optional, ≥ 0
 */
export function moneyDollarsToCents(build: (base: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return build(z.number()).transform(dollarsToCents);
}
