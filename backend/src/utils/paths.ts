// Drops null, empty, and all-slash segments. Returns '' when nothing remains.
export function joinStoragePath(...segments: (string | null | undefined)[]): string {
  return segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}
