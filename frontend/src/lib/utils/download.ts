/**
 * Trigger a browser "save as" download for an in-memory Blob.
 *
 * Collapses the byte-identical 7-step object-URL → anchor → click → revoke dance that was hand-rolled
 * at two sites (C278 dedup): expense-api's CSV export and the settings store's backup download. One
 * source of truth for the download mechanics — a future change (e.g. revoke-after-click ordering, or
 * a Safari workaround) is one edit, not N. Behavior-preserving: same ordering as both prior copies
 * (append → click → revoke → remove). Browser-only; callers already guard `browser` upstream.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
	const url = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	window.URL.revokeObjectURL(url);
	document.body.removeChild(a);
}
