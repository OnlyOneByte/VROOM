import { ApiError } from '$lib/utils/error-handling';

// Lives here, not in sync-manager: offline-storage and sync-manager both need it, and import each other.
export type SyncFailureKind = 'transient' | 'auth' | 'terminal';

export function classifySyncFailure(error: unknown): SyncFailureKind {
	const status = error instanceof ApiError ? error.statusCode : undefined;
	if (status === undefined) return 'transient';
	if (status === 401) return 'auth';
	if (status === 408 || status === 429) return 'transient';
	if (status >= 400 && status < 500) return 'terminal';
	return 'transient';
}
