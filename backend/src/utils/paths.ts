/**
 * Join storage path segments, normalizing slashes.
 * Strips leading/trailing slashes from each segment, joins with '/'.
 * Returns empty string if all segments are empty.
 */
export function joinStoragePath(...segments: (string | null | undefined)[]): string {
  return segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}
