export type CsvDelimiter = ',' | ';' | '\t';

const CANDIDATES: CsvDelimiter[] = [',', ';', '\t'];

export function csvDelimiter(text: string): CsvDelimiter {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts = new Map<string, number>();
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return CANDIDATES.reduce((best, d) =>
    (counts.get(d) ?? 0) > (counts.get(best) ?? 0) ? d : best
  );
}
