import { extractErrorMessage } from './error-handling';

export interface LoadStateOptions<T> {
	initial?: T | null;
	loadingInitially?: boolean;
	fallbackMessage?: string;
	onError?: (error: unknown) => void;
}

export interface LoadState<T> {
	readonly data: T | null;
	readonly isLoading: boolean;
	readonly error: string | null;
	readonly isError: boolean;
	run(loader: () => Promise<T>): Promise<T | null>;
	set(value: T): void;
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
