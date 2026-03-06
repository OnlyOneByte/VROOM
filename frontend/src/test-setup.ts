import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Create a proper localStorage mock that behaves like the real thing
const createLocalStorageMock = () => {
	let store: Record<string, string> = {};

	const mock = {
		getItem: vi.fn((key: string) => {
			return store[key] || null;
		}),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((index: number) => Object.keys(store)[index] || null),
		// Add a method to reset the store for tests
		__reset: () => {
			store = {};
			mock.getItem.mockClear();
			mock.setItem.mockClear();
			mock.removeItem.mockClear();
			mock.clear.mockClear();
		}
	};

	return mock;
};

const localStorageMock = createLocalStorageMock();

Object.defineProperty(window, 'localStorage', {
	value: localStorageMock,
	writable: true
});

// Make localStorage mock available globally for tests
(global as unknown as { localStorageMock: typeof localStorageMock }).localStorageMock =
	localStorageMock;

// Mock addEventListener and removeEventListener on window
window.addEventListener = vi.fn();
window.removeEventListener = vi.fn();

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	value: vi.fn(() => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	}))
});

// Mock service worker
const createServiceWorkerMock = () => {
	const mock = {
		register: vi.fn(() =>
			Promise.resolve({
				addEventListener: vi.fn()
			})
		),
		ready: Promise.resolve({
			sync: {
				register: vi.fn()
			}
		}),
		addEventListener: vi.fn(),
		// Add a method to reset the mock
		__reset: () => {
			mock.register.mockClear();
			mock.addEventListener.mockClear();
			// Reset ready to default
			mock.ready = Promise.resolve({
				sync: {
					register: vi.fn()
				}
			});
		}
	};
	return mock;
};

const mockServiceWorker = createServiceWorkerMock();

Object.defineProperty(navigator, 'serviceWorker', {
	value: mockServiceWorker,
	writable: true
});

// Make service worker mock available globally for tests
(global as unknown as { mockServiceWorker: typeof mockServiceWorker }).mockServiceWorker =
	mockServiceWorker;

// Mock online status
Object.defineProperty(navigator, 'onLine', {
	value: true,
	writable: true
});

// Mock fetch
global.fetch = vi.fn();

// Mock browser environment
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: '1.0.0'
}));

// Ensure browser is available globally for tests
(global as unknown as { browser: boolean }).browser = true;
