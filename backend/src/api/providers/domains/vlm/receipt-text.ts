const NUMBER = String.raw`\d{1,3}(?:[.,\s]\d{3})*[.,]\d{1,3}|\d+(?:[.,]\d{1,3})?`;
const MONEY = new RegExp(String.raw`[$€£]?\s*(${NUMBER})\s*(?:[$€£]|EUR|USD|GBP)?`, 'i');

const TOTAL_LABEL =
  /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+ttc|total|summe|gesamt|importe|montant|fuel\s+sale|sale\s+amount|amount)\b/i;
const NOT_TOTAL = /\b(sub\s*-?total|tax|mwst|vat|tva|change|cash|tip|discount|savings)\b/i;

const VOLUME_BEFORE = new RegExp(
  String.raw`(?<![\d.,$€£])(${NUMBER})\s*(gal(?:lons?)?\b|g\b|l(?:itres?|iters?)?\b|1(?=\s*(?:x|@|\*|$)))`,
  'i'
);
const VOLUME_AFTER = new RegExp(
  String.raw`\b(gal(?:lons?)?|lit(?:res?|ers?))\b\s*[:=]?\s*(${NUMBER})`,
  'i'
);
const PRICE_PER_UNIT = new RegExp(
  String.raw`(?:price\s*\/\s*(gal|l)\b|\/\s*(gal|l|1)\b|per\s+(gal|litre|liter))\s*[:=]?\s*[$€£]?\s*(${NUMBER})|[$€£]?\s*(${NUMBER})\s*(?:[$€£]|EUR|USD|GBP)?\s*\/\s*(gal|l|1)\b`,
  'i'
);

const ADDRESS_OR_NOISE =
  /\d{3,}|@|www\.|https?:|\b(street|st\.|road|rd\.|ave|avenue|blvd|str\.|tel|phone|fax|date|time|invoice|receipt|pump|thank)\b/i;

export type ReceiptVolumeUnit = 'gallons_us' | 'liters';

export interface ReceiptTextFields {
  amount?: number;
  date?: string;
  vendor?: string;
  category?: 'fuel';
  volume?: number;
  volumeUnit?: ReceiptVolumeUnit;
  pricePerUnit?: number;
}

export function toNumber(raw: string): number | undefined {
  const compact = raw.replace(/\s/g, '');
  const lastSep = Math.max(compact.lastIndexOf('.'), compact.lastIndexOf(','));
  let normalised = compact;
  if (lastSep !== -1) {
    const decimals = compact.length - lastSep - 1;
    const intPart = compact.slice(0, lastSep).replace(/[.,]/g, '');
    normalised =
      decimals === 3 && /[.,]\d{3}[.,]/.test(compact)
        ? `${intPart}${compact.slice(lastSep + 1)}`
        : `${intPart}.${compact.slice(lastSep + 1)}`;
  }
  const value = Number(normalised);
  return Number.isFinite(value) ? value : undefined;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function findAmount(all: string[]): number | undefined {
  let best: { value: number; score: number } | undefined;
  all.forEach((line, index) => {
    const label = TOTAL_LABEL.exec(line);
    if (!label || NOT_TOTAL.test(line)) return;
    const afterLabel = line.slice(label.index + label[0].length);
    const match = MONEY.exec(afterLabel) ?? MONEY.exec(all[index + 1] ?? '');
    const value = match ? toNumber(match[1]) : undefined;
    if (value === undefined || value <= 0) return;
    const score = (/grand|due|summe|ttc/i.test(label[0]) ? 2 : 1) * 1000 + index;
    if (!best || score > best.score) best = { value, score };
  });
  return best?.value;
}

function isoDate(year: number, month: number, day: number, now: Date): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return undefined;
  const tomorrow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (year < 2000 || date.getTime() > tomorrow) return undefined;
  return date.toISOString().slice(0, 10);
}

function findDate(text: string, now: Date): string | undefined {
  const candidates: (string | undefined)[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    candidates.push(isoDate(+m[1], +m[2], +m[3], now));
  }
  for (const m of text.matchAll(/\b(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})\b/g)) {
    const year = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    const [a, b] = [+m[1], +m[3]];
    const dayFirst = m[2] === '.' || a > 12;
    candidates.push(dayFirst ? isoDate(year, b, a, now) : isoDate(year, a, b, now));
  }
  return candidates.find((c) => c !== undefined);
}

function findVendor(all: string[]): string | undefined {
  for (const line of all.slice(0, 6)) {
    if (ADDRESS_OR_NOISE.test(line) || MONEY.test(line.replace(/[A-Za-z]/g, ''))) continue;
    if ((line.match(/[A-Za-zÀ-ž]/g) ?? []).length < 3) continue;
    return line.slice(0, 120);
  }
  return undefined;
}

function unitOf(token: string): ReceiptVolumeUnit {
  return /^g/i.test(token) ? 'gallons_us' : 'liters';
}

type FoundVolume = { volume: number; unit: ReceiptVolumeUnit };

function volumeIn(line: string): FoundVolume | undefined {
  const after = VOLUME_AFTER.exec(line);
  const before = VOLUME_BEFORE.exec(line);
  const [raw, unit] = after
    ? [after[2], after[1]]
    : before && /[.,]/.test(before[1])
      ? [before[1], before[2]]
      : [];
  const volume = raw === undefined ? undefined : toNumber(raw);
  return volume && unit ? { volume, unit: unitOf(unit) } : undefined;
}

function findVolume(all: string[]): FoundVolume | undefined {
  for (const line of all) {
    const found = volumeIn(line);
    if (found) return found;
  }
  return undefined;
}

function findPricePerUnit(all: string[]): number | undefined {
  for (const line of all) {
    const m = PRICE_PER_UNIT.exec(line);
    if (!m) continue;
    const value = toNumber(m[4] ?? m[5]);
    if (value && value > 0) return value;
  }
  return undefined;
}

export function parseReceiptText(text: string, now: Date = new Date()): ReceiptTextFields {
  const all = lines(text);
  const fields: ReceiptTextFields = {};

  let amount = findAmount(all);
  const date = findDate(text, now);
  const vendor = findVendor(all);
  const volume = findVolume(all);
  let pricePerUnit = findPricePerUnit(all);

  if (volume) {
    if (amount === undefined && pricePerUnit !== undefined) {
      amount = round(volume.volume * pricePerUnit, 2);
    }
    if (pricePerUnit === undefined && amount !== undefined) {
      pricePerUnit = round(amount / volume.volume, 3);
    }
    fields.volume = volume.volume;
    fields.volumeUnit = volume.unit;
    fields.category = 'fuel';
  }

  if (amount !== undefined) fields.amount = amount;
  if (date) fields.date = date;
  if (vendor) fields.vendor = vendor;
  if (pricePerUnit !== undefined && volume) fields.pricePerUnit = pricePerUnit;
  return fields;
}
