import { curveMonotoneX } from 'd3-shape';

export const SMOOTH_CURVE = curveMonotoneX;

const TREND_LINE_PROPS = {
	spline: {
		curve: SMOOTH_CURVE
	},
	points: {
		r: 4,
		class: 'fill-background stroke-2'
	}
} as const;

export const SINGLE_POINT_PROPS = { r: 6, class: 'stroke-2' } as const;

export function getTrendLineProps(dataLength: number) {
	if (dataLength <= 1) {
		return {
			spline: { curve: SMOOTH_CURVE },
			points: SINGLE_POINT_PROPS
		};
	}
	return TREND_LINE_PROPS;
}
