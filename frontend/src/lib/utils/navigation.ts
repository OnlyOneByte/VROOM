import { goto, preloadCode } from '$app/navigation';
import { match, resolve } from '$app/paths';
import { routes } from '#lib/routes.ts';

export async function gotoDynamic(path: string): Promise<void> {
	// Runtime paths (e.g. a ?returnTo= value) cannot be checked against the generated route union.
	try {
		await goto(resolve(...([path] as Parameters<typeof resolve>)));
	} catch {
		await goto(resolve(routes.dashboard));
	}
}

export function preloadDynamic(path: string): void {
	void match(path)
		.then(route => (route ? preloadCode(route.id) : undefined))
		.catch(() => {});
}

export function gotoWithQuery(
	resolvedPath: string,
	query: Record<string, string>
): ReturnType<typeof goto> {
	const qs = new URLSearchParams(query).toString();
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is pre-resolved by caller
	return goto(qs ? `${resolvedPath}?${qs}` : resolvedPath);
}
