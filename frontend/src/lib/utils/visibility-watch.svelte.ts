/**
 * Viewport-aware visibility watcher for chart containers.
 *
 * Uses **IntersectionObserver** as the primary visibility gate — elements start
 * with `visible = false` and flip to `true` only when they enter the viewport.
 * A sticky `hasBeenVisible` flag prevents re-mount thrashing: once a chart has
 * rendered, it stays rendered even when scrolled out of view.
 *
 * A **MutationObserver** watches for `hidden` attribute changes on ancestor
 * elements (bits-ui `Tabs.Content` uses `hidden` / `display: none` on inactive
 * tabs). When a previously-rendered chart's tab becomes visible again, the
 * MutationObserver restores `visible = true` without waiting for IO.
 *
 * **SSR safety:** This module uses browser-only APIs (IntersectionObserver,
 * MutationObserver, offsetParent). It is safe to import at module level, but
 * `createVisibilityWatch()` must only be called from component `<script>` blocks
 * which run exclusively on the client.
 */

import { browser } from '$app/environment';

/**
 * Find the closest ancestor (or self) that has the `hidden` attribute.
 * Returns null if no such ancestor exists.
 */
function findHiddenAncestor(el: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = el;
	while (current) {
		if (current.hasAttribute('hidden')) return current;
		current = current.parentElement;
	}
	return null;
}

/**
 * Check if an element is currently hidden via `display: none`.
 * `offsetParent` returns null for elements with `display: none` (or their
 * descendants), and also for `position: fixed` elements — but chart containers
 * are never fixed-positioned, so this is safe.
 */
function isElementHidden(el: HTMLElement): boolean {
	return el.offsetParent === null;
}

export interface VisibilityWatchResult {
	/** Bind this to the container element. */
	get el(): HTMLDivElement | undefined;
	set el(v: HTMLDivElement | undefined);
	/** Whether the element is currently visible (has positive dimensions). */
	get visible(): boolean;
}

/**
 * Create a reactive visibility watcher for use in Svelte 5 components.
 *
 * Elements start with `visible = false`. IntersectionObserver is the primary
 * gate — `visible` flips to `true` only when the element enters the viewport.
 * Once visible, the sticky `hasBeenVisible` flag keeps `visible = true` even
 * when scrolled out of view (prevents chart re-mount thrashing).
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { createVisibilityWatch } from '$lib/utils/visibility-watch';
 *   let gate = createVisibilityWatch();
 * </script>
 *
 * <div bind:this={gate.el} style="min-height: 300px">
 *   {#if gate.visible}
 *     <Chart ... />
 *   {/if}
 * </div>
 * ```
 */
export function createVisibilityWatch(): VisibilityWatchResult {
	let el = $state<HTMLDivElement | undefined>();
	let visible = $state(false);
	let hasBeenVisible = false; // sticky flag — once true, never goes back to false
	let mutationObserver: MutationObserver | null = null;
	let intersectionObserver: IntersectionObserver | null = null;

	function cleanup() {
		mutationObserver?.disconnect();
		mutationObserver = null;
		intersectionObserver?.disconnect();
		intersectionObserver = null;
	}

	$effect(() => {
		const node = el;
		if (!node || !browser) {
			visible = false;
			return;
		}

		// Start with visible = false. Let IntersectionObserver determine
		// actual viewport intersection (no synchronous offsetParent check).
		visible = false;

		// Watch for `hidden` attribute changes on ancestors (tab switches).
		const hiddenAncestor = findHiddenAncestor(node);
		if (hiddenAncestor) {
			mutationObserver = new MutationObserver(() => {
				// When tab becomes visible and chart was previously rendered,
				// restore visibility without waiting for IO.
				if (!isElementHidden(node) && hasBeenVisible) {
					visible = true;
				}
			});
			mutationObserver.observe(hiddenAncestor, {
				attributes: true,
				attributeFilter: ['hidden']
			});
		}

		// IntersectionObserver is the primary visibility gate.
		intersectionObserver = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					if (entry.isIntersecting && !isElementHidden(node)) {
						visible = true;
						hasBeenVisible = true; // Sticky: never re-mount on scroll
					}
					// If not intersecting but was previously visible, keep visible = true
					// (hasBeenVisible prevents re-mount thrashing on scroll)
				}
			},
			{ threshold: 0 }
		);
		intersectionObserver.observe(node);

		return () => cleanup();
	});

	return {
		get el() {
			return el;
		},
		set el(v) {
			el = v;
		},
		get visible() {
			return visible;
		}
	};
}
