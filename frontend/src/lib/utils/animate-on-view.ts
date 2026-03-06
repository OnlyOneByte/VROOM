/**
 * Svelte action that adds a CSS class when the element enters the viewport.
 * Used to trigger chart draw-in animations only when visible.
 * The class is removed when the element leaves the viewport so the
 * animation replays on every re-entry (e.g. tab switch, scroll).
 *
 * Usage: <div use:animateOnView={'chart-line-animated'}>
 */
export function animateOnView(node: HTMLElement, className: string) {
	let rafId: number | null = null;

	const observer = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					// Double-rAF ensures the browser has painted the initial frame
					// before adding the animation class
					rafId = requestAnimationFrame(() => {
						rafId = requestAnimationFrame(() => {
							rafId = null;
							node.classList.add(className);
						});
					});
				} else {
					// Cancel pending rAF if the element left the viewport before
					// the animation class was applied (fast scroll).
					if (rafId != null) {
						cancelAnimationFrame(rafId);
						rafId = null;
					}
					node.classList.remove(className);
				}
			}
		},
		{ threshold: 0.15 }
	);

	observer.observe(node);

	return {
		destroy() {
			if (rafId != null) cancelAnimationFrame(rafId);
			observer.disconnect();
		}
	};
}
