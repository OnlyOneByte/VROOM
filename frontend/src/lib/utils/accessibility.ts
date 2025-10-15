// Focus management utilities
export function trapFocus(element: HTMLElement): () => void {
	const focusableElements = element.querySelectorAll(
		'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
	);
	const firstElement = focusableElements[0] as HTMLElement;
	const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Tab') {
			if (e.shiftKey) {
				if (document.activeElement === firstElement) {
					e.preventDefault();
					lastElement.focus();
				}
			} else {
				if (document.activeElement === lastElement) {
					e.preventDefault();
					firstElement.focus();
				}
			}
		}
	}

	element.addEventListener('keydown', handleKeyDown);

	// Focus the first element
	firstElement?.focus();

	// Return cleanup function
	return () => {
		element.removeEventListener('keydown', handleKeyDown);
	};
}

// Screen reader announcements
export function announceToScreenReader(
	message: string,
	priority: 'polite' | 'assertive' = 'polite'
): void {
	const announcement = document.createElement('div');
	announcement.setAttribute('aria-live', priority);
	announcement.setAttribute('aria-atomic', 'true');
	announcement.className = 'sr-only';
	announcement.textContent = message;

	document.body.appendChild(announcement);

	// Remove after announcement
	setTimeout(() => {
		document.body.removeChild(announcement);
	}, 1000);
}

// Keyboard navigation helpers
export function handleKeyboardNavigation(
	event: KeyboardEvent,
	options: {
		onEnter?: () => void;
		onSpace?: () => void;
		onEscape?: () => void;
		onArrowUp?: () => void;
		onArrowDown?: () => void;
		onArrowLeft?: () => void;
		onArrowRight?: () => void;
	}
): void {
	switch (event.key) {
		case 'Enter':
			event.preventDefault();
			options.onEnter?.();
			break;
		case ' ':
			event.preventDefault();
			options.onSpace?.();
			break;
		case 'Escape':
			event.preventDefault();
			options.onEscape?.();
			break;
		case 'ArrowUp':
			event.preventDefault();
			options.onArrowUp?.();
			break;
		case 'ArrowDown':
			event.preventDefault();
			options.onArrowDown?.();
			break;
		case 'ArrowLeft':
			event.preventDefault();
			options.onArrowLeft?.();
			break;
		case 'ArrowRight':
			event.preventDefault();
			options.onArrowRight?.();
			break;
	}
}

// ARIA label generators
export function generateAriaLabel(context: string, value?: string | number): string {
	if (value !== undefined) {
		return `${context}: ${value}`;
	}
	return context;
}

export function generateAriaDescription(items: string[]): string {
	return items.filter(Boolean).join(', ');
}

// Color contrast utilities
export function getContrastRatio(color1: string, color2: string): number {
	const getLuminance = (color: string): number => {
		// Simple luminance calculation for hex colors
		const hex = color.replace('#', '');
		const r = parseInt(hex.substr(0, 2), 16) / 255;
		const g = parseInt(hex.substr(2, 2), 16) / 255;
		const b = parseInt(hex.substr(4, 2), 16) / 255;

		const sRGB = [r, g, b].map(c => {
			return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		});

		return 0.2126 * (sRGB[0] ?? 0) + 0.7152 * (sRGB[1] ?? 0) + 0.0722 * (sRGB[2] ?? 0);
	};

	const lum1 = getLuminance(color1);
	const lum2 = getLuminance(color2);
	const brightest = Math.max(lum1, lum2);
	const darkest = Math.min(lum1, lum2);

	return (brightest + 0.05) / (darkest + 0.05);
}

export function meetsWCAGContrast(
	color1: string,
	color2: string,
	level: 'AA' | 'AAA' = 'AA'
): boolean {
	const ratio = getContrastRatio(color1, color2);
	return level === 'AA' ? ratio >= 4.5 : ratio >= 7;
}

// Reduced motion detection
export function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// High contrast detection
export function prefersHighContrast(): boolean {
	return window.matchMedia('(prefers-contrast: high)').matches;
}

// Focus visible utilities
export function addFocusVisiblePolyfill(): void {
	let hadKeyboardEvent = true;

	const inputTypesAllowlist = {
		radio: true,
		checkbox: true,
		range: true,
		color: true,
		date: true,
		datetime: true,
		'datetime-local': true,
		month: true,
		time: true,
		week: true
	};

	function onPointerDown() {
		hadKeyboardEvent = false;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.metaKey || e.altKey || e.ctrlKey) {
			return;
		}
		hadKeyboardEvent = true;
	}

	function onFocus(e: FocusEvent) {
		const target = e.target as HTMLElement;
		if (shouldShowFocusRing(target)) {
			target.classList.add('focus-visible');
		}
	}

	function onBlur(e: FocusEvent) {
		const target = e.target as HTMLElement;
		target.classList.remove('focus-visible');
	}

	function shouldShowFocusRing(el: HTMLElement): boolean {
		const { type, readOnly, disabled } = el as HTMLInputElement;

		if (disabled || readOnly) {
			return false;
		}

		if (
			el.tagName === 'INPUT' &&
			type &&
			!inputTypesAllowlist[type as keyof typeof inputTypesAllowlist]
		) {
			return false;
		}

		return hadKeyboardEvent || el.matches(':focus-visible');
	}

	document.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('mousedown', onPointerDown, true);
	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('touchstart', onPointerDown, true);
	document.addEventListener('focus', onFocus, true);
	document.addEventListener('blur', onBlur, true);
}

// Skip link utility
export function createSkipLink(targetId: string, text = 'Skip to main content'): HTMLElement {
	const skipLink = document.createElement('a');
	skipLink.href = `#${targetId}`;
	skipLink.textContent = text;
	skipLink.className =
		'sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 bg-primary-600 text-white p-2 z-50';

	return skipLink;
}
