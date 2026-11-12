import type { ShareLevel } from '#lib/types/index.ts';

export const shareLevelLabels: Record<ShareLevel, string> = {
	viewer: 'Viewer',
	editor: 'Editor'
};

export function shareLevelLabel(level: ShareLevel): string {
	return shareLevelLabels[level];
}
