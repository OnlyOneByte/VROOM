import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../../../../utils/logger';
import { parseReceiptText } from './receipt-text';
import type { RawExtraction, ReceiptImage, VlmProvider } from './vlm-provider';

const IDLE_STOP_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 30_000;

const LANG_PATH = join(
  dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int'
);

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function startWorker(): Promise<Worker> {
  worker ??= createWorker('eng', 1, {
    langPath: LANG_PATH,
    gzip: true,
    cacheMethod: 'none',
    errorHandler: (error: unknown) =>
      logger.warn('Text recognition failed', { error: String(error) }),
  });
  return worker;
}

export async function stopLocalOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const running = worker;
  worker = null;
  if (running) await (await running).terminate();
}

function scheduleIdleStop(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void stopLocalOcr(), IDLE_STOP_MS);
  idleTimer.unref?.();
}

async function recognizeOnce(image: Buffer): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Text recognition timed out')),
      RECOGNIZE_TIMEOUT_MS
    );
  });
  try {
    const running = await startWorker();
    const { data } = await Promise.race([running.recognize(image), timedOut]);
    return data.text;
  } catch (error) {
    await stopLocalOcr();
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
    if (worker) scheduleIdleStop();
  }
}

export function recognizeText(image: Buffer): Promise<string> {
  const run = queue.then(() => recognizeOnce(image));
  queue = run.catch(() => undefined);
  return run;
}

export class LocalOcrVlmProvider implements VlmProvider {
  async extractReceipt(image: ReceiptImage): Promise<RawExtraction> {
    return { ...parseReceiptText(await recognizeText(image.data)) };
  }
}
