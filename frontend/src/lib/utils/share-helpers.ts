import type { ShareLevel } from '$lib/types';

/**
 * Vehicle-sharing display helpers. One source of truth for turning a `ShareLevel` into its
 * human label, so the Share dialog (owner side) and the Shared-with-you card (invitee side) cannot
 * drift. Typed `Record<ShareLevel, string>` rather than a ternary so adding a future level is a
 * compile error here (the single place), not a silent fall-through to "Viewer".
 */
export const shareLevelLabels: Record<ShareLevel, string> = {
	viewer: 'Viewer',
	editor: 'Editor'
};

/** "viewer" → "Viewer", "editor" → "Editor". */
export function shareLevelLabel(level: ShareLevel): string {
	return shareLevelLabels[level];
}
