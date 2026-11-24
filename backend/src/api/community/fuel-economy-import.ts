import { parse } from 'csv-parse/sync';
import { suggestCatalogModel } from '../../utils/vehicle-catalog';

export interface FuelEconomyRow {
  year: string;
  make: string;
  baseModel: string;
  atvType: string;
  comb08: string;
  combE: string;
}

export type RatingRange = [min: number, max: number];

export interface FuelEconomyRatings {
  source: string;
  license: string;
  retrieved: string;
  ratings: Record<string, RatingRange>;
}

const KM_PER_MILE = 1.609344;
const LITRES_PER_US_GALLON = 3.785411784;
const GAS_TYPES = new Set(['', 'Diesel', 'FFV']);
const HYBRID_TYPES = new Set(['Hybrid', 'Plug-in Hybrid']);

function rating(row: FuelEconomyRow): { vehicleType: string; value: number } | null {
  if (row.atvType === 'EV') {
    const kwhPer100Miles = Number(row.combE);
    return kwhPer100Miles > 0
      ? { vehicleType: 'electric', value: (100 * KM_PER_MILE) / kwhPer100Miles }
      : null;
  }
  const mpg = Number(row.comb08);
  if (!(mpg > 0)) return null;
  const vehicleType = HYBRID_TYPES.has(row.atvType)
    ? 'hybrid'
    : GAS_TYPES.has(row.atvType)
      ? 'gas'
      : null;
  return vehicleType ? { vehicleType, value: (mpg * KM_PER_MILE) / LITRES_PER_US_GALLON } : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function ratingsFromRows(rows: FuelEconomyRow[]): Record<string, RatingRange> {
  const ranges = new Map<string, RatingRange>();
  for (const row of rows) {
    const rated = rating(row);
    const modelId = rated ? suggestCatalogModel(row.make, row.baseModel) : null;
    if (!rated || !modelId) continue;
    const key = `${modelId}|${row.year}|${rated.vehicleType}`;
    const range = ranges.get(key);
    ranges.set(
      key,
      range
        ? [Math.min(range[0], rated.value), Math.max(range[1], rated.value)]
        : [rated.value, rated.value]
    );
  }
  return Object.fromEntries(
    [...ranges]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, [min, max]]) => [key, [round2(min), round2(max)]])
  );
}

export function formatRatings(output: FuelEconomyRatings): string {
  const lines = Object.entries(output.ratings).map(
    ([key, range]) => `    ${JSON.stringify(key)}: ${JSON.stringify(range)}`
  );
  const header = JSON.stringify({ ...output, ratings: undefined }, null, 2).slice(0, -2);
  return `${header},\n  "ratings": {\n${lines.join(',\n')}\n  }\n}\n`;
}

if (import.meta.main) {
  const [csvPath, outPath, retrieved] = Bun.argv.slice(2);
  if (!csvPath || !outPath || !retrieved) {
    process.stderr.write(
      'usage: bun fuel-economy-import.ts <vehicles.csv> <out.json> <YYYY-MM-DD>\n'
    );
    process.exit(1);
  }
  const rows: FuelEconomyRow[] = parse(await Bun.file(csvPath).text(), {
    columns: true,
    skip_empty_lines: true,
  });
  const output: FuelEconomyRatings = {
    source: 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip',
    license: 'US government work, public domain',
    retrieved,
    ratings: ratingsFromRows(rows),
  };
  await Bun.write(outPath, formatRatings(output));
  process.stdout.write(`${Object.keys(output.ratings).length} ratings from ${rows.length} rows\n`);
}
