export function focusLeftOn(origin: Element | null): boolean {
	const active = document.activeElement;
	return active === origin || active === null || active === document.body;
}

export function focusFirstButton(container: Element | null | undefined): void {
	const target =
		container?.querySelector('button') ?? (container?.hasAttribute('tabindex') ? container : null);
	if (target instanceof HTMLElement) target.focus();
}

export function focusMainHeading(): void {
	const heading = document.querySelector<HTMLElement>('main h1');
	if (!heading) return;
	if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
	heading.focus({ preventScroll: true });
}
