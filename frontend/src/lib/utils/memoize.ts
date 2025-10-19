/**
 * Simple memoization utility for expensive calculations
 * Uses a Map to cache results based on JSON serialization
 */

/**
 * Memoize a function with a single argument
 * @param fn - Function to memoize
 * @returns Memoized function
 */
export function memoize<T, R>(fn: (arg: T) => R): (arg: T) => R {
	const cache = new Map<string, R>();

	return (arg: T): R => {
		const key = JSON.stringify(arg);

		if (cache.has(key)) {
			return cache.get(key)!;
		}

		const result = fn(arg);
		cache.set(key, result);
		return result;
	};
}

/**
 * Memoize a function with multiple arguments
 * @param fn - Function to memoize
 * @returns Memoized function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoizeMulti<T extends any[], R>(fn: (...args: T) => R): (...args: T) => R {
	const cache = new Map<string, R>();

	return (...args: T): R => {
		const key = JSON.stringify(args);

		if (cache.has(key)) {
			return cache.get(key)!;
		}

		const result = fn(...args);
		cache.set(key, result);
		return result;
	};
}

/**
 * Create a debounced version of a function
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delay);
	};
}
