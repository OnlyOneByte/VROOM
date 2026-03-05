/**
 * Svelte action that adds a CSS class when the element enters the viewport.
 * Used to trigger chart draw-in animations only when visible.
 * The class is removed when the element leaves the viewport so the
 * animation replays on every re-entry (e.g. tab switch, scroll).
 *
 * Usage: <div use:animateOnView={'chart-line-animated'}>
 */
export function animateOnView(node: HTMLElement, className: string) {
	const observer = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					// Double-rAF ensures the browser has painted the initial frame
					// before adding the animation class
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							node.classList.add(className);
						});
					});
				} else {
					node.classList.remove(className);
				}
			}
		},
		{ threshold: 0.15 }
	);

	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
