import { PGlite } from '@electric-sql/pglite';

export const STARTUP_ATTEMPTS = 3;
const CLOSE_WAIT_MS = 2_000;

type Engine = Pick<PGlite, 'waitReady' | 'close'>;

export function isEngineCrash(error: unknown): boolean {
  return /access to a null reference/.test(String(error));
}

async function release(engine: Engine): Promise<void> {
  await Promise.race([engine.close(), Bun.sleep(CLOSE_WAIT_MS)]).catch(() => {});
}

export async function startPglite<T extends Engine = PGlite>(
  create: () => T = () => new PGlite() as unknown as T,
  onRetry: (attempt: number, error: unknown) => void = () => {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const engine = create();
    try {
      await engine.waitReady;
      return engine;
    } catch (error) {
      await release(engine);
      if (attempt >= STARTUP_ATTEMPTS || !isEngineCrash(error)) throw error;
      onRetry(attempt, error);
    }
  }
}
