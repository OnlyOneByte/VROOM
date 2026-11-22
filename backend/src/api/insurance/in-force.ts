import { and, gte, lt, type SQL } from 'drizzle-orm';
import { insuranceTerms } from '../../db/schema';
import { calendarDayIn, zonedMidnight } from '../../utils/time-zone';

function coveredDay(now: Date, timeZone = 'UTC'): { start: Date; end: Date } {
  const [year, month, day] = calendarDayIn(now, timeZone).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return {
    start: zonedMidnight(year, month - 1, day, timeZone),
    end: zonedMidnight(year, month - 1, day + 1, timeZone),
  };
}

export function isTermInForce(
  term: { startDate: Date | null; endDate: Date | null },
  now: Date,
  timeZone?: string
): boolean {
  const day = coveredDay(now, timeZone);
  return (
    term.startDate instanceof Date &&
    term.endDate instanceof Date &&
    term.startDate.getTime() < day.end.getTime() &&
    term.endDate.getTime() >= day.start.getTime()
  );
}

export function termInForceAt(now: Date, timeZone?: string): SQL {
  const day = coveredDay(now, timeZone);
  return and(lt(insuranceTerms.startDate, day.end), gte(insuranceTerms.endDate, day.start)) as SQL;
}
