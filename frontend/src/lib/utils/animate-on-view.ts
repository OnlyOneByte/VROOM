/**
 * Svelte action that adds a CSS class when the element enters the viewport.
 * Used to trigger chart draw-in animations only when visible.
 *
 * Usage: <div use:animateOnView={'chart-line-animated'}>
 */
export function animateOnView(node: HTMLElement, className: string) {
	const observer = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					node.classList.add(className);
					observer.unobserve(node);
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
