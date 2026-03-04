/**
 * Centralized folder name resolution for Google Drive backup folders.
 * All callers that create or reference the VROOM Drive folder should
 * use this function to determine the effective folder name.
 */

/** Returns the resolved Google Drive folder name based on user preference. */
export function resolveVroomFolderName(
  customName: string | null | undefined,
  displayName: string
): string {
  if (customName != null) {
    const trimmed = customName.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return `VROOM Car Tracker - ${displayName}`;
}
