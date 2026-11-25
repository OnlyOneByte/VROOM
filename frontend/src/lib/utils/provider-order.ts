export function oldestFirst(
	a: { id: string; createdAt?: string | null },
	b: { id: string; createdAt?: string | null }
): number {
	return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
}
