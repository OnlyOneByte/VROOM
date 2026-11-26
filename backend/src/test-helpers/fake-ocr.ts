import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'tesseract.js';

const FIXTURES = join(import.meta.dir, 'provider-contracts', 'fixtures');

const TEXT_BY_FIXTURE: Record<string, string> = {
  'receipt-fuel-eu.png': [
    'ARAL Tankstelle',
    'Hauptstr. 12, 10115 Berlin',
    'Datum: 03.11.2026 09:12',
    'Super E10',
    '',
    '42,17 1 x 1,789 EUR/1',
    'Betrag 75,44 EUR',
    '',
    'SUMME EUR 75,44',
    '',
    'MwSt 19% 12,04',
  ].join('\n'),
  'receipt-fuel-us.png': [
    'SHELL',
    '',
    '1234 EL CAMINO REAL',
    'SAN JOSE CA 95126',
    'DATE 11/02/2626 14:31',
    'PUMP 07',
    '',
    'REGULAR',
    '',
    'GALLONS 11.482',
    'PRICE/GAL $4.599',
    'FUEL SALE $52.81',
    'TOTAL $52.81',
    '',
    'VISA ****1234',
    'THANK YOU',
  ].join('\n'),
};

const KNOWN = Object.entries(TEXT_BY_FIXTURE).map(([file, text]) => ({
  bytes: readFileSync(join(FIXTURES, file)),
  text,
}));

export function fakeOcrWorker(): Promise<Worker> {
  return Promise.resolve({
    recognize: async (image: Buffer) => {
      const match = KNOWN.find(({ bytes }) => bytes.equals(image));
      if (!match) throw 'Error attempting to read image.';
      return { data: { text: match.text } };
    },
    terminate: async () => undefined,
  } as unknown as Worker);
}
