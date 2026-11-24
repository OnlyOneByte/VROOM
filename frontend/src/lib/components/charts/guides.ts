import { distinctYTicks } from '#lib/utils/chart-formatters.ts';

type TickScale = { ticks?: (_count: number) => number[]; domain?: () => unknown[] };

const GUIDE_VALUES = 3;
const GUIDE_SPACING = 50;
const MAX_TICK_COUNT = 20;
const MIN_COVER = 0.75;
const ROUNDER_MARGIN = 0.1;

export function guideTicks(format: (_v: number) => string) {
	const fallback = distinctYTicks(format, GUIDE_VALUES * GUIDE_SPACING);
	return (scale: TickScale): number[] => {
		const [start = 0, end = 0] = (scale.domain?.() ?? []).map(Number);
		const span = end - start;
		let best: number[] | undefined;
		let bestCover = 0;
		for (let count = 2; span > 0 && count <= MAX_TICK_COUNT; count++) {
			const ticks = scale.ticks?.(count) ?? [];
			if (new Set(ticks.map(format)).size < ticks.length) continue;
			const odd = ticks.length % 2 ? ticks : ticks.slice(0, -1);
			if (odd.length < GUIDE_VALUES) continue;
			const cover = (odd.at(-1)! - odd[0]!) / span;
			if (cover > (best ? bestCover + ROUNDER_MARGIN : 0)) {
				best = [odd[0]!, odd[(odd.length - 1) / 2]!, odd.at(-1)!];
				bestCover = cover;
			}
		}
		return best && bestCover >= MIN_COVER
			? best
			: fallback(scale as Parameters<typeof fallback>[0]);
	};
}
