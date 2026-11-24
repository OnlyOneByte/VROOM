export const COLUMN_WIDTH = 12;

export function columnWidth(bandwidth: number | undefined, grouped: boolean): number | undefined {
	if (grouped || !bandwidth || bandwidth < COLUMN_WIDTH) return undefined;
	return COLUMN_WIDTH;
}
