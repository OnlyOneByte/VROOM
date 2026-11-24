import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExtraction, type ReceiptDraft } from '../../api/providers/domains/vlm/prompt';
import type { VlmProvider } from '../../api/providers/domains/vlm/vlm-provider';
import { outboundResolver } from '../../utils/outbound-url';

const FIXTURES = join(import.meta.dir, 'fixtures');

const RECEIPTS: { file: string; expected: ReceiptDraft }[] = [
  {
    file: 'receipt-fuel-us.png',
    expected: {
      amount: 52.81,
      vendor: 'SHELL',
      volume: 11.482,
      volumeUnit: 'gallons_us',
      pricePerUnit: 4.599,
      category: 'fuel',
    },
  },
  {
    file: 'receipt-fuel-eu.png',
    expected: {
      amount: 75.44,
      date: '2026-11-03',
      vendor: 'ARAL Tankstelle',
      volume: 42.17,
      volumeUnit: 'liters',
      pricePerUnit: 1.789,
      category: 'fuel',
    },
  },
];

export function describeOcrContract(
  name: string,
  create: () => VlmProvider,
  stop: () => Promise<void>
): void {
  describe(`${name} OCR contract`, () => {
    afterAll(stop);

    for (const { file, expected } of RECEIPTS) {
      test(`reads ${file} into a draft without any outbound request`, async () => {
        const fetchSpy = spyOn(globalThis, 'fetch');
        const lookupSpy = spyOn(outboundResolver, 'lookup');
        try {
          const raw = await create().extractReceipt({
            data: readFileSync(join(FIXTURES, file)),
            mimeType: 'image/png',
          });
          expect(parseExtraction(raw)).toEqual(expected);
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(lookupSpy).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
          lookupSpy.mockRestore();
        }
      }, 60_000);
    }

    test('an image that is not a picture is an error, not a draft', async () => {
      await expect(
        create().extractReceipt({ data: Buffer.from('not an image'), mimeType: 'image/png' })
      ).rejects.toThrow();
    }, 60_000);
  });
}
