import type { Component } from 'svelte';

export type AnyIcon = Component<Record<string, unknown>>;

export interface ChartMarker {
	at: unknown;
	label: string;
	detail?: string;
	rows?: string[];
}

export interface ChartDensity {
	at: unknown;
	value: number;
	label: string;
}

export interface ChartAnnotations {
	label: string;
	markers?: ChartMarker[];
	density?: ChartDensity[];
	note?: string;
	formatAt: (_at: unknown) => string;
}
