import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { appContext } from '../../app-context';
import { firstRow } from '../../db/first-row';
import {
  type CalendarFeedOptions,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  reminders,
  reminderVehicles,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { currencyFormatOptions, minorUnitScale } from '../../utils/money';
import { calendarDayIn, isValidTimeZone } from '../../utils/time-zone';
import type { CalendarEvent } from './ics';

const HORIZON_DAYS = 365;
const DAY_MS = 86_400_000;

interface FeedContext {
  userId: string;
  options: CalendarFeedOptions;
  vehicleNames: Map<string, string>;
  money: (cents: number) => string;
  day: (date: Date) => string;
  today: Date;
  horizon: Date;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcNoon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function withDetail(title: string, parts: (string | null | undefined)[]): string {
  const extra = parts.filter((p): p is string => !!p);
  return extra.length > 0 ? `${title} · ${extra.join(' · ')}` : title;
}

function namesFor(ctx: FeedContext, vehicleIds: string[]): string | null {
  if (!ctx.options.vehicleNames) return null;
  const names = vehicleIds.map((id) => ctx.vehicleNames.get(id)).filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

function amountFor(ctx: FeedContext, cents: number | null | undefined): string | null {
  return ctx.options.amounts && typeof cents === 'number' && cents > 0 ? ctx.money(cents) : null;
}

async function vehiclesByReminder(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await appContext()
    .asyncDb.select()
    .from(reminderVehicles)
    .where(inArray(reminderVehicles.reminderId, ids));
  for (const row of rows)
    map.set(row.reminderId, [...(map.get(row.reminderId) ?? []), row.vehicleId]);
  return map;
}

async function reminderEvents(ctx: FeedContext): Promise<CalendarEvent[]> {
  const rows = await appContext()
    .asyncDb.select()
    .from(reminders)
    .where(
      and(
        eq(reminders.userId, ctx.userId),
        eq(reminders.isActive, true),
        isNotNull(reminders.nextDueDate)
      )
    );
  const due = rows.filter(
    (r) => r.triggerMode !== 'mileage' && r.nextDueDate && r.nextDueDate <= ctx.horizon
  );
  const linked = await vehiclesByReminder(due.map((r) => r.id));
  return due.map((r) => {
    const date = ctx.day(r.nextDueDate as Date);
    const owned = (linked.get(r.id) ?? []).filter((id) => ctx.vehicleNames.has(id));
    return {
      uid: `reminder-${r.id}-${date.replace(/-/g, '')}@vroom`,
      date,
      summary: withDetail(`Reminder: ${r.name}`, [
        namesFor(ctx, owned),
        r.type === 'expense' ? amountFor(ctx, r.expenseAmount) : null,
      ]),
    };
  });
}

async function insuranceEvents(ctx: FeedContext): Promise<CalendarEvent[]> {
  const rows = await appContext()
    .asyncDb.select({ term: insuranceTerms, company: insurancePolicies.company })
    .from(insuranceTerms)
    .innerJoin(insurancePolicies, eq(insuranceTerms.policyId, insurancePolicies.id))
    .where(
      and(
        eq(insurancePolicies.userId, ctx.userId),
        eq(insurancePolicies.isActive, true),
        gte(insuranceTerms.endDate, new Date(ctx.today.getTime() - DAY_MS))
      )
    )
    .then((found) => found.filter((r) => ctx.day(r.term.endDate) >= isoDay(ctx.today)));
  const termIds = rows.map((r) => r.term.id);
  const covered = new Map<string, string[]>();
  if (termIds.length > 0) {
    const links = await appContext()
      .asyncDb.select()
      .from(insuranceTermVehicles)
      .where(inArray(insuranceTermVehicles.termId, termIds));
    for (const l of links) covered.set(l.termId, [...(covered.get(l.termId) ?? []), l.vehicleId]);
  }
  return rows
    .filter((r) => r.term.endDate <= ctx.horizon)
    .map(({ term, company }) => {
      const date = ctx.day(term.endDate);
      return {
        uid: `insurance-${term.id}-${date.replace(/-/g, '')}@vroom`,
        date,
        summary: withDetail(`Insurance renews: ${company}`, [
          namesFor(ctx, covered.get(term.id) ?? []),
          amountFor(ctx, term.totalCost),
        ]),
      };
    });
}

function addMonths(start: Date, months: number, day: number): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12));
}

export function paymentDates(
  loan: {
    startDate: Date;
    termMonths: number;
    paymentFrequency: string;
    paymentDayOfMonth: number | null;
    endDate: Date | null;
  },
  from: Date,
  to: Date
): Date[] {
  const last =
    loan.endDate ??
    addMonths(
      loan.startDate,
      loan.termMonths,
      loan.paymentFrequency === 'monthly'
        ? (loan.paymentDayOfMonth ?? loan.startDate.getUTCDate())
        : loan.startDate.getUTCDate()
    );
  const dates: Date[] = [];
  const push = (d: Date) => {
    if (d >= from && d <= to && d <= last) dates.push(d);
  };
  if (loan.paymentFrequency === 'monthly') {
    const day = loan.paymentDayOfMonth ?? loan.startDate.getUTCDate();
    for (let m = 1; m <= loan.termMonths; m++) push(addMonths(loan.startDate, m, day));
  } else if (loan.paymentFrequency === 'weekly' || loan.paymentFrequency === 'bi-weekly') {
    const step = (loan.paymentFrequency === 'weekly' ? 7 : 14) * DAY_MS;
    const first = loan.startDate.getTime() + step;
    const skip = Math.max(0, Math.ceil((from.getTime() - first) / step));
    for (let t = first + skip * step; t <= Math.min(to.getTime(), last.getTime()); t += step) {
      push(new Date(t));
    }
  }
  return dates;
}

async function loanEvents(ctx: FeedContext): Promise<CalendarEvent[]> {
  const rows = await appContext()
    .asyncDb.select({ loan: vehicleFinancing })
    .from(vehicleFinancing)
    .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
    .where(and(eq(vehicles.userId, ctx.userId), eq(vehicleFinancing.isActive, true)));
  return rows.flatMap(({ loan }) =>
    paymentDates(
      {
        ...loan,
        startDate: utcNoon(ctx.day(loan.startDate)),
        endDate: loan.endDate ? utcNoon(ctx.day(loan.endDate)) : null,
      },
      ctx.today,
      ctx.horizon
    ).map((due) => {
      const date = isoDay(due);
      const title = loan.financingType === 'lease' ? 'Lease payment' : 'Loan payment';
      return {
        uid: `loan-${loan.id}-${date.replace(/-/g, '')}@vroom`,
        date,
        summary: withDetail(title, [
          namesFor(ctx, [loan.vehicleId]),
          amountFor(ctx, loan.paymentAmount),
        ]),
      };
    })
  );
}

export async function buildFeedEvents(
  userId: string,
  options: CalendarFeedOptions,
  now: Date = new Date()
): Promise<CalendarEvent[]> {
  const owned = await appContext()
    .asyncDb.select({
      id: vehicles.id,
      nickname: vehicles.nickname,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(vehicles)
    .where(eq(vehicles.userId, userId));
  const prefs = await appContext()
    .asyncDb.select({ currency: userPreferences.currencyUnit })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then(firstRow);
  const currency = prefs?.currency ?? 'USD';
  const formatter = new Intl.NumberFormat('en-US', currencyFormatOptions(currency));
  const timeZone = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : null;
  const day = (date: Date) => (timeZone ? calendarDayIn(date, timeZone) : isoDay(date));
  const today = new Date(`${day(now)}T00:00:00Z`);
  const ctx: FeedContext = {
    userId,
    options,
    vehicleNames: new Map(owned.map((v) => [v.id, v.nickname || `${v.make} ${v.model}`])),
    money: (minor) => formatter.format(minor / minorUnitScale(currency)),
    day,
    today,
    horizon: new Date(today.getTime() + HORIZON_DAYS * DAY_MS),
  };
  const events = [
    ...(options.reminders ? await reminderEvents(ctx) : []),
    ...(options.insurance ? await insuranceEvents(ctx) : []),
    ...(options.loans ? await loanEvents(ctx) : []),
  ];
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}
