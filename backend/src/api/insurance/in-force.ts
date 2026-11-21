import { and, gte, lte, type SQL } from 'drizzle-orm';
import { insuranceTerms } from '../../db/schema';

export function isTermInForce(
  term: { startDate: Date | null; endDate: Date | null },
  now: Date
): boolean {
  const nowSeconds = Math.floor(now.getTime() / 1000) * 1000;
  return (
    term.startDate instanceof Date &&
    term.endDate instanceof Date &&
    term.startDate.getTime() <= nowSeconds &&
    nowSeconds <= term.endDate.getTime()
  );
}

export function termInForceAt(now: Date): SQL {
  return and(lte(insuranceTerms.startDate, now), gte(insuranceTerms.endDate, now)) as SQL;
}
