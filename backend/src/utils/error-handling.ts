// For capturing a message into a variable or stored column. Structured log fields keep passing the
// raw error.
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
