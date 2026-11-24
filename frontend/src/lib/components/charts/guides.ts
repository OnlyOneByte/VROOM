import { distinctYTicks } from '#lib/utils/chart-formatters.ts';

type TickScale = { ticks?: (_count: number) => number[]; domain?: () => unknown[] };

const GUIDE_VALUES = 3;
const GUIDE_SPACING = 50;
const MAX_TICK_COUNT = 20;
const MIN_COVER = 0.75;
const ROUNDER_MARGIN = 0.1;

function evenThree(ticks: number[]): number[] | undefined {
	if (ticks.length < GUIDE_VALUES || ticks.length % 2 === 0) return undefined;
	return [ticks[0]!, ticks[(ticks.length - 1) / 2]!, ticks[ticks.length - 1]!];
}

export function guideTicks(format: (_v: number) => string) {
	const fallback = distinctYTicks(format, GUIDE_VALUES * GUIDE_SPACING);
	return (scale: TickScale): number[] => {
		const [low = 0, high = 0] = (scale.domain?.() ?? []).map(Number).toSorted((a, b) => a - b);
		const span = high - low;
		let best: number[] | undefined;
		let bestCover = 0;
		for (let count = 2; span > 0 && count <= MAX_TICK_COUNT; count++) {
			const ticks = scale.ticks?.(count) ?? [];
			if (new Set(ticks.map(format)).size !== ticks.length) continue;
			for (const three of [
				evenThree(ticks),
				evenThree(ticks.slice(0, -1)),
				evenThree(ticks.slice(1))
			]) {
				const cover = three ? (three[2]! - three[0]!) / span : 0;
				if (cover > (best ? bestCover + ROUNDER_MARGIN : 0)) [best, bestCover] = [three, cover];
			}
		}
		return best && bestCover >= MIN_COVER
			? best
			: fallback(scale as Parameters<typeof fallback>[0]);
	};
}
