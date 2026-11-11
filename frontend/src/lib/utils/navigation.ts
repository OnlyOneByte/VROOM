import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export function gotoDynamic(path: string): ReturnType<typeof goto> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return goto(resolve(path as any));
}

export function gotoWithQuery(
	resolvedPath: string,
	query: Record<string, string>
): ReturnType<typeof goto> {
	const qs = new URLSearchParams(query).toString();
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is pre-resolved by caller
	return goto(qs ? `${resolvedPath}?${qs}` : resolvedPath);
}
