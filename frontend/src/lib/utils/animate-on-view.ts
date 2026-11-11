export function animateOnView(node: HTMLElement, className: string) {
	let rafId: number | null = null;

	const observer = new IntersectionObserver(
		entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					rafId = requestAnimationFrame(() => {
						rafId = requestAnimationFrame(() => {
							rafId = null;
							node.classList.add(className);
						});
					});
				} else {
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
