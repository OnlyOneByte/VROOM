import { untrack } from 'svelte';

const SEARCH_DEBOUNCE_MS = 300;

interface ExpenseListReloadOptions {
	/** False until the list is shown. Changes made before then are absorbed, not refetched. */
	ready: () => boolean;
	search: () => string;
	/** Serialized snapshot of every server-side filter except the search term. */
	filterKey: () => string;
	/** Refetches the list from page 0. */
	reload: () => void;
}

// Call once during component init: registers two $effects that refetch from page 0.
export function useExpenseListReload(options: ExpenseListReloadOptions) {
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;
	// Plain (non-reactive) snapshots, so recording them does not re-run the effects.
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
		// Cancels the pending debounce on the next change or on unmount.
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
		// For a change the caller applies itself. Records the new state first, so the effects do not
		// refetch the same change a second time.
		reloadNow() {
			clearTimeout(searchDebounce);
			lastSearch = options.search();
			lastFilterKey = options.filterKey();
			if (options.ready()) options.reload();
		}
	};
}
