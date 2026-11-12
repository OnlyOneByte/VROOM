export function reactiveState<T extends object>(initial: T): T {
	const state = $state(initial);
	return state;
}
