export function focusLeftOn(origin: Element | null): boolean {
	const active = document.activeElement;
	return active === origin || active === null || active === document.body;
}

export function focusFirstButton(container: Element | null | undefined): void {
	const target =
		container?.querySelector('button') ?? (container?.hasAttribute('tabindex') ? container : null);
	if (target instanceof HTMLElement) target.focus();
}
