import { browser } from '$app/env';
import { resolve } from '$app/paths';
import { routes } from '#lib/routes.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
import { getCategoryLabel } from '#lib/utils/chart-colors.ts';
import type { OfflineExpense } from '../offline-storage';

const toastId = (entryId: string) => `save-failed-${entryId}`;

export function queuedEditHref(entryId: string, returnTo: string): string {
	return `${resolve(routes.expenseNew)}?queued=${encodeURIComponent(entryId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

export function announceSaveFailure(
	entry: OfflineExpense,
	reason: string,
	retry: () => void
): void {
	if (!browser) return;
	const returnTo = `${location.pathname}${location.search}`;
	const editable = !!entry.needsAttention && !entry.serverId;
	appStore.addNotification({
		type: 'error',
		urgent: true,
		message: `${formatCurrency(entry.amount)} ${getCategoryLabel(entry.category)} on ${formatDate(entry.date)} wasn't saved`,
		description: reason,
		toastId: toastId(entry.id),
		duration: Number.POSITIVE_INFINITY,
		action: editable
			? { label: 'Edit', onClick: () => void gotoDynamic(queuedEditHref(entry.id, returnTo)) }
			: { label: 'Retry', onClick: retry }
	});
}

export function clearSaveFailure(entryId: string): void {
	if (browser) appStore.dismissToast(toastId(entryId));
}
