export interface OdometerPoint {
  odometer: number;
  at: number;
  driverId: string | null;
}

export interface TripSpan {
  start: number;
  end: number;
  at: number;
  driverId: string | null;
}

export interface Period {
  from: number;
  to: number;
}

export interface DriverDistance {
  trips: number;
  estimated: number;
}

type Interval = [number, number];

function merged(trips: readonly TripSpan[]): Interval[] {
  const spans = trips
    .filter((t) => t.end > t.start)
    .map((t): Interval => [t.start, t.end])
    .sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [start, end] of spans) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

function uncovered(from: number, to: number, cover: readonly Interval[]): number {
  let covered = 0;
  for (const [start, end] of cover) {
    covered += Math.max(0, Math.min(end, to) - Math.max(start, from));
  }
  return to - from - covered;
}

function sequence(points: readonly OdometerPoint[], period: Period): OdometerPoint[] {
  const sorted = [...points].sort((a, b) => a.at - b.at || a.odometer - b.odometer);
  const opener = sorted.filter((p) => p.at < period.from).at(-1);
  const inside = sorted.filter((p) => p.at >= period.from && p.at <= period.to);
  return opener ? [opener, ...inside] : inside;
}

export function attributeDistance(
  points: readonly OdometerPoint[],
  trips: readonly TripSpan[],
  period: Period,
  withEstimates: boolean
): Map<string | null, DriverDistance> {
  const totals = new Map<string | null, DriverDistance>();
  const add = (driverId: string | null, field: keyof DriverDistance, distance: number) => {
    const row = totals.get(driverId) ?? { trips: 0, estimated: 0 };
    row[field] += distance;
    totals.set(driverId, row);
  };

  const counted = trips.filter(
    (trip) => trip.at >= period.from && trip.at <= period.to && trip.end > trip.start
  );
  for (const trip of counted) add(trip.driverId, 'trips', trip.end - trip.start);
  if (!withEstimates) return totals;

  const ordered = sequence(points, period);
  let opening = ordered[0];
  for (const closing of ordered.slice(1)) {
    if (!opening || closing.odometer <= opening.odometer) continue;
    const from = opening.at;
    const between = trips.filter((trip) => trip.at >= from && trip.at <= closing.at);
    const gap = uncovered(opening.odometer, closing.odometer, merged(between));
    if (gap > 0) add(closing.driverId, 'estimated', gap);
    opening = closing;
  }
  return totals;
}
