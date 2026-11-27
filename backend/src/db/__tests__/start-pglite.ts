import { PGlite } from '@electric-sql/pglite';

export const STARTUP_ATTEMPTS = 3;

export function isEngineCrash(error: unknown): boolean {
  return (
    error instanceof WebAssembly.RuntimeError || /access to a null reference/.test(String(error))
  );
}

export async function startPglite(
  create: () => Promise<PGlite> = () => PGlite.create(),
  onRetry: (attempt: number, error: unknown) => void = () => {}
): Promise<PGlite> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create();
    } catch (error) {
      if (attempt >= STARTUP_ATTEMPTS || !isEngineCrash(error)) throw error;
      onRetry(attempt, error);
    }
  }
}
