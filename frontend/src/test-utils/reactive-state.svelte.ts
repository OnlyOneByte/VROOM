/**
 * A deeply reactive object for tests that drive component props with real `$state`, so the
 * component's effects re-run when a test mutates a field. Built on the public rune rather than
 * svelte's internal `proxy`, which the svelte lint rules forbid.
 */
export function reactiveState<T extends object>(initial: T): T {
	const state = $state(initial);
	return state;
}
