import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'tesseract.js';
import {
  LOCAL_OCR_LANG_PATH,
  OcrUnavailableError,
  OcrUnreadableError,
  recognizeText,
  setLocalOcrForTest,
  stopLocalOcr,
} from '../local-ocr';

function fakeWorker(recognize: () => Promise<string>): Worker {
  return {
    recognize: async () => ({ data: { text: await recognize() } }),
    terminate: async () => undefined,
  } as unknown as Worker;
}

afterEach(async () => {
  await stopLocalOcr().catch(() => undefined);
  setLocalOcrForTest();
});

describe('the built-in text reader engine', () => {
  test('a worker that never starts times out instead of blocking later scans', async () => {
    let starts = 0;
    setLocalOcrForTest({
      timeoutMs: 50,
      createWorker: () => {
        starts++;
        return starts === 1
          ? new Promise<Worker>(() => undefined)
          : Promise.resolve(fakeWorker(async () => 'TOTAL 1.00'));
      },
    });
    await expect(recognizeText(Buffer.from('a'))).rejects.toBeInstanceOf(OcrUnavailableError);
    expect(await recognizeText(Buffer.from('b'))).toBe('TOTAL 1.00');
    expect(starts).toBe(2);
  });

  test('a picture it cannot read is reported as unreadable, and the worker is kept', async () => {
    let starts = 0;
    setLocalOcrForTest({
      createWorker: async () => {
        starts++;
        return fakeWorker(async () => {
          throw 'Error attempting to read image.';
        });
      },
    });
    await expect(recognizeText(Buffer.from('a'))).rejects.toBeInstanceOf(OcrUnreadableError);
    await expect(recognizeText(Buffer.from('b'))).rejects.toBeInstanceOf(OcrUnreadableError);
    expect(starts).toBe(1);
  });

  test('more than eight waiting scans are turned away at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setLocalOcrForTest({
      createWorker: async () =>
        fakeWorker(async () => {
          await gate;
          return 'ok';
        }),
    });
    const accepted = Array.from({ length: 8 }, () => recognizeText(Buffer.from('a')));
    await expect(recognizeText(Buffer.from('a'))).rejects.toBeInstanceOf(OcrUnavailableError);
    release();
    expect(await Promise.all(accepted)).toEqual(Array(8).fill('ok'));
  });

  test('the English model ships on disk, so no model is fetched over the network', () => {
    expect(existsSync(join(LOCAL_OCR_LANG_PATH, 'eng.traineddata.gz'))).toBe(true);
  });
});
