import { describe, expect, test } from 'bun:test';
import { parseExtraction } from '../prompt';
import { parseReceiptText, toNumber } from '../receipt-text';

const NOW = new Date(2026, 10, 23);

const US_FUEL = [
  'SHELL',
  '1234 EL CAMINO REAL',
  'SAN JOSE CA 95126',
  'DATE 11/02/2026 14:31',
  'PUMP 07',
  'REGULAR',
  'GALLONS 11.482',
  'PRICE/GAL $4.599',
  'FUEL SALE $52.81',
  'TOTAL $52.81',
  'VISA ****1234',
].join('\n');

const EU_FUEL = [
  'ARAL Tankstelle',
  'Hauptstr. 12, 10115 Berlin',
  'Datum: 03.11.2026 09:12',
  'Super E10',
  '42,17 1 x 1,789 EUR/1',
  'Betrag 75,44 EUR',
  'SUMME EUR 75,44',
  'MwSt 19% 12,04',
].join('\n');

const REPAIR = [
  "Joe's Auto Repair",
  'INVOICE #4471',
  'Date: 2026-10-28',
  'Synthetic oil change ....... 69.99',
  'Subtotal 127.49',
  'Tax 8.53',
  'Amount Due $136.02',
].join('\n');

describe('parseReceiptText', () => {
  test('a US fuel receipt gives total, date, station, gallons and price per gallon', () => {
    expect(parseReceiptText(US_FUEL, NOW)).toEqual({
      amount: 52.81,
      date: '2026-11-02',
      vendor: 'SHELL',
      category: 'fuel',
      volume: 11.482,
      volumeUnit: 'gallons_us',
      pricePerUnit: 4.599,
    });
  });

  test('a European receipt reads day-first dates, decimal commas and an l misread as 1', () => {
    expect(parseReceiptText(EU_FUEL, NOW)).toEqual({
      amount: 75.44,
      date: '2026-11-03',
      vendor: 'ARAL Tankstelle',
      category: 'fuel',
      volume: 42.17,
      volumeUnit: 'liters',
      pricePerUnit: 1.789,
    });
  });

  test('a repair invoice takes the amount due, not the subtotal or tax, and is not fuel', () => {
    expect(parseReceiptText(REPAIR, NOW)).toEqual({
      amount: 136.02,
      date: '2026-10-28',
      vendor: "Joe's Auto Repair",
    });
  });

  test('a date in the future or before 2000 is a misread and is dropped', () => {
    expect(parseReceiptText('DATE 11/02/2626\nTOTAL 9.99', NOW)).toEqual({ amount: 9.99 });
    expect(parseReceiptText('DATE 11/02/1926\nTOTAL 9.99', NOW).date).toBeUndefined();
    expect(parseReceiptText('DATE 11/24/2026\nTOTAL 9.99', NOW).date).toBe('2026-11-24');
  });

  test('two of amount, volume and price fill in the third', () => {
    expect(parseReceiptText('10.000 GAL\nPRICE/GAL $4.00', NOW)).toMatchObject({ amount: 40 });
    expect(parseReceiptText('40.00 L\nTOTAL 72.00', NOW)).toMatchObject({ pricePerUnit: 1.8 });
  });

  test('text with nothing recognisable gives an empty draft', () => {
    expect(parseReceiptText('', NOW)).toEqual({});
    expect(parseReceiptText('~~ ## ..', NOW)).toEqual({});
  });

  test('the draft schema accepts the parsed fields and drops a bad unit', () => {
    expect(parseExtraction({ ...parseReceiptText(US_FUEL, NOW) })).toMatchObject({
      volumeUnit: 'gallons_us',
    });
    expect(parseExtraction({ volume: 12, volumeUnit: 'barrels' })).toEqual({ volume: 12 });
  });
});

describe('toNumber', () => {
  test.each([
    ['52.81', 52.81],
    ['75,44', 75.44],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['11.482', 11.482],
    ['42', 42],
  ])('%s is %d', (raw, value) => {
    expect(toNumber(raw)).toBe(value);
  });
});
