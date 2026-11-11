import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export function gotoDynamic(path: string): ReturnType<typeof goto> {
	// Runtime paths (e.g. a ?returnTo= value) cannot be checked against the generated route union.
	return goto(resolve(...([path] as Parameters<typeof resolve>)));
}

export function gotoWithQuery(
	resolvedPath: string,
	query: Record<string, string>
): ReturnType<typeof goto> {
	const qs = new URLSearchParams(query).toString();
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is pre-resolved by caller
	return goto(qs ? `${resolvedPath}?${qs}` : resolvedPath);
}
