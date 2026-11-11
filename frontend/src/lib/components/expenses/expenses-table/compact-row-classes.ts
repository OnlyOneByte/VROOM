export const MOBILE_ROW_SUMMARY_CLASS = 'flex w-full items-start gap-3 px-3 py-3 text-left';

/** Edit/Delete are drawn at 28px but keep 40px touch targets via a vertical hit-area extension that must not overlap. */
export const MOBILE_ROW_ACTION_CLASS =
	"h-7 px-2 text-xs relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

export const MOBILE_ROW_ACTIONS_CONTAINER_CLASS =
	'flex items-center justify-end gap-2 px-3 pt-1.5 pb-3';
