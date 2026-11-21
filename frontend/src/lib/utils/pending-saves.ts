const pendingSaves = new Set<() => boolean>();

export function trackPendingSave(isPending: () => boolean): () => void {
	pendingSaves.add(isPending);
	return () => pendingSaves.delete(isPending);
}

export function hasPendingSave(): boolean {
	for (const isPending of pendingSaves) {
		if (isPending()) return true;
	}
	return false;
}
