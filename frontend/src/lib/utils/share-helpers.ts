import type { ShareLevel } from '$lib/types';

export const shareLevelLabels: Record<ShareLevel, string> = {
	viewer: 'Viewer',
	editor: 'Editor'
};

export function shareLevelLabel(level: ShareLevel): string {
	return shareLevelLabels[level];
}
