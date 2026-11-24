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
  test('a worker that never starts times out instead of blocking the queue', async () => {
    setLocalOcrForTest({ timeoutMs: 50, createWorker: () => new Promise<Worker>(() => undefined) });
    const first = recognizeText(Buffer.from('a'));
    const second = recognizeText(Buffer.from('b'));
    await expect(first).rejects.toBeInstanceOf(OcrUnavailableError);
    await expect(second).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  test('after a failed start, scans stay refused without starting another worker', async () => {
    let starts = 0;
    setLocalOcrForTest({
      createWorker: () => {
        starts++;
        return Promise.reject(new Error('model would not load'));
      },
    });
    await expect(recognizeText(Buffer.from('a'))).rejects.toBeInstanceOf(OcrUnavailableError);
    await expect(recognizeText(Buffer.from('b'))).rejects.toBeInstanceOf(OcrUnavailableError);
    await expect(recognizeText(Buffer.from('c'))).rejects.toBeInstanceOf(OcrUnavailableError);
    expect(starts).toBe(1);
  });

  test('a start that times out is not retried until a restart', async () => {
    let starts = 0;
    setLocalOcrForTest({
      timeoutMs: 50,
      createWorker: () => {
        starts++;
        return new Promise<Worker>(() => undefined);
      },
    });
    await expect(recognizeText(Buffer.from('a'))).rejects.toBeInstanceOf(OcrUnavailableError);
    await expect(recognizeText(Buffer.from('b'))).rejects.toBeInstanceOf(OcrUnavailableError);
    expect(starts).toBe(1);
  });

  test('a late crash from a replaced worker leaves the current worker in place', async () => {
    const listeners: ((error: unknown) => void)[] = [];
    let starts = 0;
    setLocalOcrForTest({
      createWorker: async () => {
        starts++;
        const w = fakeWorker(async () => 'ok') as unknown as Record<string, unknown>;
        w.worker = {
          on: (_event: string, listener: (error: unknown) => void) => listeners.push(listener),
        };
        return w as unknown as Worker;
      },
    });
    await recognizeText(Buffer.from('a'));
    await stopLocalOcr();
    await recognizeText(Buffer.from('b'));
    listeners[0]?.(new Error('old worker crashed'));
    await recognizeText(Buffer.from('c'));
    expect(starts).toBe(2);
  });

  test('a failed start is reported as unavailable, not as an unreadable picture', async () => {
    setLocalOcrForTest({
      createWorker: () => Promise.reject('Error: model not found'),
    });
    const error = await recognizeText(Buffer.from('a')).catch((e) => e);
    expect(error).toBeInstanceOf(OcrUnavailableError);
    expect(error).not.toBeInstanceOf(OcrUnreadableError);
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
