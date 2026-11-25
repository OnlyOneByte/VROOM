import { tick } from 'svelte';

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

export function focusInView(target: HTMLElement | null | undefined): void {
	target?.scrollIntoView({ block: 'center' });
	target?.focus({ preventScroll: true });
}

const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

export function landOn(target: HTMLElement, settleMs = 5000): () => void {
	const pin = () => target.scrollIntoView({ block: 'start' });
	const observer = new ResizeObserver(pin);
	const stop = () => {
		observer.disconnect();
		clearTimeout(timer);
		for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop);
	};
	const timer = setTimeout(stop, settleMs);
	for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { passive: true });
	pin();
	target.focus({ preventScroll: true });
	observer.observe(document.body);
	return stop;
}

export async function focusFirstProblem(form: Element | null | undefined): Promise<void> {
	await tick();
	focusInView(
		form?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"], #submit-error')
	);
}
