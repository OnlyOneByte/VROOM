import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../../../../utils/logger';
import { parseReceiptText } from './receipt-text';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const IDLE_STOP_MS = 60_000;
export const LOCAL_OCR_MAX_WAITING = 8;
const ENGINE_CRASH = /^RuntimeError\b/;
const START_CRASH = /\bRuntimeError\b/;

export const LOCAL_OCR_LANG_PATH = join(
  dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int'
);

export class OcrUnavailableError extends Error {}
export class OcrUnreadableError extends Error {}

type WorkerFactory = () => Promise<Worker>;
type ThreadHandle = {
  worker?: { on?: (event: string, listener: (error: unknown) => void) => void };
};

function startRealWorker(): Promise<Worker> {
  if (!existsSync(join(LOCAL_OCR_LANG_PATH, 'eng.traineddata.gz'))) {
    return Promise.reject(new OcrUnavailableError('The text reader model is missing'));
  }
  return new Promise((resolve, reject) => {
    let starting = true;
    createWorker('eng', 1, {
      langPath: LOCAL_OCR_LANG_PATH,
      gzip: true,
      cacheMethod: 'none',
      errorHandler: (error: unknown) => {
        if (starting) reject(new OcrUnavailableError(`The text reader failed to start: ${error}`));
        else logger.warn('Text recognition failed', { error: String(error) });
      },
    }).then((started) => {
      starting = false;
      resolve(started);
    }, reject);
  });
}

let workerFactory: WorkerFactory = startRealWorker;
let timeoutMs = 30_000;

export function setLocalOcrForTest(
  options: { createWorker?: WorkerFactory | null; timeoutMs?: number } = {}
): void {
  workerFactory = options.createWorker ?? startRealWorker;
  timeoutMs = options.timeoutMs ?? 30_000;
  startBroken = false;
}

export function localOcrWaiting(): number {
  return waiting;
}

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let startBroken = false;

function markStartBroken(reason: string): void {
  if (startBroken) return;
  startBroken = true;
  logger.error('The built-in text reader could not start; scans stay off until a restart', {
    reason,
  });
}

function startOnceMoreAfterACrash(): Promise<Worker> {
  return workerFactory().catch((error: unknown) => {
    if (!START_CRASH.test(String(error))) throw error;
    logger.warn('The text reader crashed while starting; trying once more', {
      error: String(error),
    });
    return workerFactory();
  });
}

function startWorker(): Promise<Worker> {
  if (worker) return worker;
  if (startBroken) {
    return Promise.reject(new OcrUnavailableError('The text reader could not start'));
  }
  const mine: Promise<Worker> = startOnceMoreAfterACrash().then(
    (started) => {
      (started as unknown as ThreadHandle).worker?.on?.('error', (error) => {
        logger.warn('Text recognition worker crashed', { error: String(error) });
        if (worker === mine) worker = null;
      });
      return started;
    },
    (error) => {
      markStartBroken(String(error));
      if (worker === mine) worker = null;
      throw error instanceof OcrUnavailableError ? error : new OcrUnavailableError(String(error));
    }
  );
  worker = mine;
  return mine;
}

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function dropWorker(): void {
  const running = worker;
  worker = null;
  clearIdleTimer();
  running?.then((w) => w.terminate()).catch(() => undefined);
}

export async function stopLocalOcr(): Promise<void> {
  clearIdleTimer();
  const running = worker;
  worker = null;
  if (running) await (await running).terminate();
}

function scheduleIdleStop(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => void stopLocalOcr().catch(() => undefined), IDLE_STOP_MS);
  idleTimer.unref?.();
}

async function recognizeOnce(image: Buffer): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!started) markStartBroken('the start timed out');
      reject(new OcrUnavailableError('Text recognition timed out'));
    }, timeoutMs);
  });
  timedOut.catch(() => undefined);
  const job = startWorker().then(async (w) => {
    started = true;
    return (await w.recognize(image)).data.text;
  });
  job.catch(() => undefined);
  try {
    const text = await Promise.race([job, timedOut]);
    scheduleIdleStop();
    return text;
  } catch (error) {
    if (error instanceof OcrUnavailableError) {
      dropWorker();
      throw error;
    }
    if (ENGINE_CRASH.test(String(error))) {
      dropWorker();
      throw new OcrUnavailableError('The text reader stopped unexpectedly. Try again');
    }
    scheduleIdleStop();
    throw new OcrUnreadableError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function recognizeText(image: Buffer): Promise<string> {
  if (waiting >= LOCAL_OCR_MAX_WAITING) {
    return Promise.reject(new OcrUnavailableError('The text reader is busy'));
  }
  waiting++;
  const run = queue
    .then(() => recognizeOnce(image))
    .finally(() => {
      waiting--;
    });
  queue = run.catch(() => undefined);
  return run;
}

export class LocalOcrVlmProvider implements VlmProvider {
  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    return { ...parseReceiptText(await recognizeText(image.data)) };
  }
}
