/**
 * `createLoadState<T>()` — the shared primitive behind VROOM's repeated page
 * load triad (arch #2, step 1: extract the scaffold; pages migrate onto it one per
 * later cycle). ~14 `+page.svelte` files hand-repeat the same shape:
 *
 *     let isLoading = $state(true);
 *     let loadError = $state<string | null>(null);
 *     async function load() {
 *       isLoading = true; loadError = null;
 *       try { data = await fetch(); }
 *       catch (e) { toast(e); loadError = e instanceof Error ? e.message : 'fallback'; }
 *       finally { isLoading = false; }
 *     }
 *
 * That triad is exactly where the recurring "load failure masquerades as an empty
 * state" bug class hides (dashboard, /reminders, /settings, vehicle-detail C57) — a
 * page that forgets the `loadError` leg silently renders empty on failure. Centralizing
 * it makes the error leg structural, not per-page boilerplate.
 *
 * This is a behaviour-preserving primitive: `run()` reproduces the try/catch/finally
 * above verbatim (error message via `error instanceof Error ? .message : fallback`,
 * `isLoading` reset in `finally`, `error` cleared at the start of each run). The toast
 * stays the CALLER's job — pass an `onError` (the page's `handleErrorWithNotification`)
 * so notification policy isn't duplicated here. State is exposed through getters so a
 * `.svelte` consumer reads `state.isLoading` reactively.
 */

import { extractErrorMessage } from './error-handling';

export interface LoadStateOptions<T> {
	/** Seed value before the first successful load (defaults to null). */
	initial?: T | null;
	/** Whether `isLoading` starts true (a page that fetches on mount wants true). */
	loadingInitially?: boolean;
	/** Message when a thrown value isn't an Error. Defaults to 'Failed to load'. */
	fallbackMessage?: string;
	/** Side effect on failure (e.g. the page's toast helper). Runs before `error` is set. */
	onError?: (error: unknown) => void;
}

export interface LoadState<T> {
	/** Last successfully-loaded value (or the initial seed / null). */
	readonly data: T | null;
	/** True while a `run()` is in flight. */
	readonly isLoading: boolean;
	/** Failure message from the most recent `run()`, or null when the last run succeeded. */
	readonly error: string | null;
	/** True when a load has failed and is not currently retrying — the "show error+retry" gate. */
	readonly isError: boolean;
	/**
	 * Execute `loader`, managing isLoading/error/data the same way every page does by hand.
	 * On success: stores the value, clears error, returns it. On failure: runs `onError`,
	 * records the message, leaves `data` untouched (a returning user keeps their last view),
	 * and returns null. Never throws — the error is surfaced via `error`/`isError`.
	 */
	run(loader: () => Promise<T>): Promise<T | null>;
	/** Manually set the loaded value (e.g. after a local mutation) and clear any error. */
	set(value: T): void;
	/** Clear the error without running a loader (e.g. when a period change will refetch). */
	clearError(): void;
}

export function createLoadState<T>(options: LoadStateOptions<T> = {}): LoadState<T> {
	const fallback = options.fallbackMessage ?? 'Failed to load';
	let data = $state<T | null>(options.initial ?? null);
	let isLoading = $state<boolean>(options.loadingInitially ?? false);
	let error = $state<string | null>(null);

	return {
		get data() {
			return data;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get isError() {
			// The four-states gate the pages use: an error that is NOT currently being retried.
			// (While a retry is in flight isLoading is true, so the loading state shows instead.)
			return error !== null && !isLoading;
		},
		async run(loader: () => Promise<T>): Promise<T | null> {
			isLoading = true;
			error = null;
			try {
				const value = await loader();
				data = value;
				return value;
			} catch (e) {
				options.onError?.(e);
				error = extractErrorMessage(e, fallback);
				return null;
			} finally {
				isLoading = false;
			}
		},
		set(value: T) {
			data = value;
			error = null;
		},
		clearError() {
			error = null;
		}
	};
}
