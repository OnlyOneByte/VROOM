import type { ReceivedShare, ShareLevel } from '#lib/types/index.ts';

export function pendingInvitations(shares: ReceivedShare[]): ReceivedShare[] {
	return shares.filter(share => share.status === 'pending');
}

export const shareLevelLabels: Record<ShareLevel, string> = {
	viewer: 'Viewer',
	editor: 'Editor'
};

export function shareLevelLabel(level: ShareLevel): string {
	return shareLevelLabels[level];
}
