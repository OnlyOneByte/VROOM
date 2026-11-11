import { browser } from '$app/environment';

function findHiddenAncestor(el: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = el;
	while (current) {
		if (current.hasAttribute('hidden')) return current;
		current = current.parentElement;
	}
	return null;
}

function isElementHidden(el: HTMLElement): boolean {
	return el.offsetParent === null;
}

export interface VisibilityWatchResult {
	get el(): HTMLDivElement | undefined;
	set el(v: HTMLDivElement | undefined);
	get visible(): boolean;
}

export function createVisibilityWatch(): VisibilityWatchResult {
	let el = $state<HTMLDivElement | undefined>();
	let visible = $state(false);
	let hasBeenVisible = false;
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

		visible = false;

		const hiddenAncestor = findHiddenAncestor(node);
		if (hiddenAncestor) {
			mutationObserver = new MutationObserver(() => {
				if (!isElementHidden(node) && hasBeenVisible) {
					visible = true;
				}
			});
			mutationObserver.observe(hiddenAncestor, {
				attributes: true,
				attributeFilter: ['hidden']
			});
		}

		intersectionObserver = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					if (entry.isIntersecting && !isElementHidden(node)) {
						visible = true;
						hasBeenVisible = true;
					}
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
