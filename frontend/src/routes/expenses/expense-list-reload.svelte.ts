import { untrack } from 'svelte';

const SEARCH_DEBOUNCE_MS = 300;

interface ExpenseListReloadOptions {
	ready: () => boolean;
	search: () => string;
	filterKey: () => string;
	reload: () => void;
}

export function useExpenseListReload(options: ExpenseListReloadOptions) {
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;
	let lastSearch = '';
	let lastFilterKey = '';

	$effect(() => {
		const term = options.search();
		if (!options.ready()) {
			lastSearch = term;
			return;
		}
		if (term === lastSearch) return;
		lastSearch = term;
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(options.reload, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(searchDebounce);
	});

	$effect(() => {
		const key = options.filterKey();
		if (!options.ready()) {
			lastFilterKey = key;
			return;
		}
		if (key === lastFilterKey) return;
		lastFilterKey = key;
		untrack(options.reload);
	});

	return {
		reloadNow() {
			clearTimeout(searchDebounce);
			lastSearch = options.search();
			lastFilterKey = options.filterKey();
			if (options.ready()) options.reload();
		}
	};
}
