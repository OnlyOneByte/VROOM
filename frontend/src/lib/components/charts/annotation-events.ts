import type { ChartAnnotations } from './types.ts';

export function annotationEvents(annotations: ChartAnnotations) {
	const markers = annotations.markers ?? [];
	const density = (annotations.density ?? []).filter(d => d.value > 0);
	const order = [...new Set([...(annotations.density ?? []), ...markers].map(e => e.at))];
	const rows = order.flatMap(at => [
		...markers
			.filter(m => m.at === at)
			.flatMap(m =>
				(m.rows ?? [m.detail ? `${m.label}: ${m.detail}` : m.label]).map(what => ({
					when: annotations.formatAt(m.at),
					what
				}))
			),
		...density
			.filter(d => d.at === at)
			.map(d => ({ when: annotations.formatAt(d.at), what: d.label }))
	]);
	return { label: annotations.label, rows };
}
