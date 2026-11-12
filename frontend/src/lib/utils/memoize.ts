// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoizeMulti<T extends any[], R>(fn: (...args: T) => R): (...args: T) => R {
	const cache = new Map<string, R>();
	const MAX_CACHE_SIZE = 100;

	return (...args: T): R => {
		const key = JSON.stringify(args);

		if (cache.has(key)) {
			return cache.get(key)!;
		}

		const result = fn(...args);

		if (cache.size >= MAX_CACHE_SIZE) {
			const firstKey = cache.keys().next().value;
			if (firstKey !== undefined) cache.delete(firstKey);
		}

		cache.set(key, result);
		return result;
	};
}

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
