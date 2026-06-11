/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * The `error instanceof Error ? error.message : String(error)` idiom is hand-rolled in ~60 places
 * across the backend (catch blocks in repositories, providers, the orchestrator, route bootstrap).
 * This is the single source of truth for the VALUE form — where the message is captured into a
 * variable for control flow or storage (e.g. `connection.ts`, `index.ts` startup, the photo-ref
 * `errorMessage` column). Mirrors the frontend `utils/error-handling.ts` `extractErrorMessage` (C90).
 *
 * NOTE: the `logger.error(msg, { error: <idiom> })` structured-log sites are deliberately NOT routed
 * through this — there the idiom is the standard structured-logging shape, not a value extraction, and
 * converging them is a separate (larger) call. This helper is the seam they CAN converge onto over time.
 */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
