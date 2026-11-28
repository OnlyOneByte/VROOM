import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  cachedReceiptDraft,
  clearReceiptDraftCache,
  rememberReceiptDraft,
} from '../receipt-draft-cache';

afterEach(() => clearReceiptDraftCache());

describe('receipt draft cache', () => {
  test('a remembered draft is returned for the same key only', () => {
    rememberReceiptDraft('u1:vlm1:p1', { amount: 12 });
    expect(cachedReceiptDraft('u1:vlm1:p1')).toEqual({ amount: 12 });
    expect(cachedReceiptDraft('u2:vlm1:p1')).toBeUndefined();
    expect(cachedReceiptDraft('u1:vlm2:p1')).toBeUndefined();
  });

  test('a draft expires after a day', () => {
    rememberReceiptDraft('k', { amount: 1 });
    const later = spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1);
    try {
      expect(cachedReceiptDraft('k')).toBeUndefined();
    } finally {
      later.mockRestore();
    }
  });

  test('the cache is bounded: the oldest entry goes first', () => {
    for (let i = 0; i <= 1000; i++) rememberReceiptDraft(`k${i}`, { amount: i });
    expect(cachedReceiptDraft('k0')).toBeUndefined();
    expect(cachedReceiptDraft('k1000')).toEqual({ amount: 1000 });
  });
});
