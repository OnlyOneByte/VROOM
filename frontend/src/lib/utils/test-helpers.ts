import { render } from '@testing-library/svelte';
import { vi, type MockedFunction } from 'vitest';

// Mock data generators
export const mockUser = {
	id: 'test-user-id',
	email: 'test@example.com',
	displayName: 'Test User',
	googleId: 'google-test-id',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

export const mockVehicle = {
	id: 'test-vehicle-id',
	userId: 'test-user-id',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	licensePlate: 'ABC123',
	vin: '1HGBH41JXMN109186',
	purchasePrice: 25000,
	purchaseDate: '2020-01-01',
	initialMileage: 0,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

export const mockExpense = {
	id: 'test-expense-id',
	vehicleId: 'test-vehicle-id',
	amount: 50.0,
	description: 'Gas fill-up',
	category: 'operating',
	type: 'fuel',
	date: new Date().toISOString(),
	mileage: 1000,
	gallons: 12.5,
	location: 'Shell Station',
	notes: 'Regular unleaded',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

// Store mocks
export function createMockAuthStore() {
	return {
		subscribe: vi.fn(),
		setUser: vi.fn(),
		clearUser: vi.fn(),
		setLoading: vi.fn(),
		setError: vi.fn(),
		initialize: vi.fn(),
		loginWithGoogle: vi.fn(),
		refreshToken: vi.fn(),
		logout: vi.fn()
	};
}

export function createMockAppStore() {
	return {
		subscribe: vi.fn(),
		setVehicles: vi.fn(),
		addVehicle: vi.fn(),
		updateVehicle: vi.fn(),
		deleteVehicle: vi.fn(),
		setSelectedVehicle: vi.fn(),
		addNotification: vi.fn(),
		removeNotification: vi.fn(),
		clearNotifications: vi.fn(),
		setLoading: vi.fn(),
		toggleMobileMenu: vi.fn(),
		closeMobileMenu: vi.fn()
	};
}

// API mocks
export function mockFetch(responses: Record<string, { data: unknown; status?: number }>) {
	const mockFetch = vi.fn() as MockedFunction<typeof fetch>;

	mockFetch.mockImplementation((url: string | URL | Request) => {
		const urlString = typeof url === 'string' ? url : url.toString();
		const response = responses[urlString];

		if (!response) {
			return Promise.resolve(new Response(null, { status: 404 }));
		}

		return Promise.resolve(
			new Response(JSON.stringify(response.data), {
				status: response.status || 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
	});

	global.fetch = mockFetch;
	return mockFetch;
}

// Component testing utilities
export function renderWithMocks(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: any,
	props?: Record<string, unknown>,
	options?: {
		authState?: unknown;
		appState?: unknown;
	}
) {
	// Mock stores if needed
	if (options?.authState) {
		vi.doMock('$lib/stores/auth.js', () => ({
			authStore: {
				subscribe: (callback: (state: unknown) => void) => {
					callback(options.authState);
					return () => {};
				}
			}
		}));
	}

	if (options?.appState) {
		vi.doMock('$lib/stores/app.js', () => ({
			appStore: {
				subscribe: (callback: (state: unknown) => void) => {
					callback(options.appState);
					return () => {};
				}
			}
		}));
	}

	return render(component, props || {});
}

// Event testing utilities
export function createMockEvent(type: string, properties: Record<string, unknown> = {}): Event {
	const event = new Event(type);
	Object.assign(event, properties);
	return event;
}

export function createMockKeyboardEvent(
	key: string,
	properties: Record<string, unknown> = {}
): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key, ...properties });
	return event;
}

// Async testing utilities
export function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();

		function check() {
			if (condition()) {
				resolve();
			} else if (Date.now() - startTime > timeout) {
				reject(new Error('Timeout waiting for condition'));
			} else {
				setTimeout(check, 10);
			}
		}

		check();
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Local storage mocks
export function mockLocalStorage() {
	const store: Record<string, string> = {};

	const mockStorage = {
		getItem: vi.fn((key: string) => store[key] || null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			Object.keys(store).forEach(key => delete store[key]);
		}),
		length: 0,
		key: vi.fn()
	};

	Object.defineProperty(window, 'localStorage', {
		value: mockStorage,
		writable: true
	});

	return mockStorage;
}

// Intersection Observer mock
export function mockIntersectionObserver() {
	const mockIntersectionObserver = vi.fn();
	mockIntersectionObserver.mockReturnValue({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	});

	window.IntersectionObserver = mockIntersectionObserver;
	return mockIntersectionObserver;
}

// Resize Observer mock
export function mockResizeObserver() {
	const mockResizeObserver = vi.fn();
	mockResizeObserver.mockReturnValue({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	});

	window.ResizeObserver = mockResizeObserver;
	return mockResizeObserver;
}

// Media query mock
export function mockMatchMedia(matches = false) {
	const mockMatchMedia = vi.fn();
	mockMatchMedia.mockReturnValue({
		matches,
		media: '',
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	});

	window.matchMedia = mockMatchMedia;
	return mockMatchMedia;
}

// Service Worker mock
export function mockServiceWorker() {
	const mockServiceWorker = {
		register: vi.fn().mockResolvedValue({
			installing: null,
			waiting: null,
			active: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		}),
		getRegistration: vi.fn().mockResolvedValue(null),
		getRegistrations: vi.fn().mockResolvedValue([])
	};

	Object.defineProperty(navigator, 'serviceWorker', {
		value: mockServiceWorker,
		writable: true
	});

	return mockServiceWorker;
}

// Test setup helper
export function setupTestEnvironment() {
	// Mock all the browser APIs
	mockLocalStorage();
	mockIntersectionObserver();
	mockResizeObserver();
	mockMatchMedia();
	mockServiceWorker();

	// Mock console methods to reduce noise in tests
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});

	// Clean up after each test
	return () => {
		vi.clearAllMocks();
		vi.resetAllMocks();
	};
}

// Accessibility testing helpers
export function getByRole(
	container: HTMLElement,
	role: string,
	options?: { name?: string }
): HTMLElement {
	const elements = container.querySelectorAll(`[role="${role}"]`);

	if (options?.name) {
		for (const element of elements) {
			const accessibleName =
				element.getAttribute('aria-label') ||
				element.getAttribute('aria-labelledby') ||
				element.textContent;

			if (accessibleName?.includes(options.name)) {
				return element as HTMLElement;
			}
		}
		throw new Error(`No element with role "${role}" and name "${options.name}" found`);
	}

	if (elements.length === 0) {
		throw new Error(`No element with role "${role}" found`);
	}

	if (elements.length > 1) {
		throw new Error(`Multiple elements with role "${role}" found`);
	}

	return elements[0] as HTMLElement;
}

export function checkAccessibility(element: HTMLElement): {
	passed: boolean;
	violations: string[];
} {
	const violations: string[] = [];

	// Check for alt text on images
	const images = element.querySelectorAll('img');
	images.forEach(img => {
		if (!img.getAttribute('alt')) {
			violations.push('Image missing alt text');
		}
	});

	// Check for form labels
	const inputs = element.querySelectorAll('input, select, textarea');
	inputs.forEach(input => {
		const id = input.getAttribute('id');
		const ariaLabel = input.getAttribute('aria-label');
		const ariaLabelledBy = input.getAttribute('aria-labelledby');

		if (!ariaLabel && !ariaLabelledBy && (!id || !element.querySelector(`label[for="${id}"]`))) {
			violations.push('Form control missing label');
		}
	});

	// Check for button accessibility
	const buttons = element.querySelectorAll('button, [role="button"]');
	buttons.forEach(button => {
		const text = button.textContent?.trim();
		const ariaLabel = button.getAttribute('aria-label');

		if (!text && !ariaLabel) {
			violations.push('Button missing accessible name');
		}
	});

	return {
		passed: violations.length === 0,
		violations
	};
}
