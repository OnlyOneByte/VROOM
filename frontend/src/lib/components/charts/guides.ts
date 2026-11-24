import { distinctYTicks } from '#lib/utils/chart-formatters.ts';

type TickScale = { ticks?: (_count: number) => number[] };

const GUIDE_VALUES = 3;
const GUIDE_SPACING = 50;
const MAX_TICK_COUNT = 8;

function evenThree(ticks: number[]): number[] | undefined {
	if (ticks.length < GUIDE_VALUES || ticks.length % 2 === 0) return undefined;
	return [ticks[0]!, ticks[(ticks.length - 1) / 2]!, ticks[ticks.length - 1]!];
}

export function guideTicks(format: (_v: number) => string) {
	const fallback = distinctYTicks(format, GUIDE_VALUES * GUIDE_SPACING);
	return (scale: TickScale): number[] => {
		for (let count = 2; count <= MAX_TICK_COUNT; count++) {
			const three = evenThree(scale.ticks?.(count) ?? []);
			if (three && new Set(three.map(format)).size === GUIDE_VALUES) return three;
		}
		return fallback(scale as Parameters<typeof fallback>[0]);
	};
}
