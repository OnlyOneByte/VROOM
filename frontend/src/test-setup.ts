import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

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

(global as unknown as { localStorageMock: typeof localStorageMock }).localStorageMock =
	localStorageMock;

window.addEventListener = vi.fn();
window.removeEventListener = vi.fn();

Object.defineProperty(window, 'matchMedia', {
	value: vi.fn(() => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	}))
});

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
		__reset: () => {
			mock.register.mockClear();
			mock.addEventListener.mockClear();
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

(global as unknown as { mockServiceWorker: typeof mockServiceWorker }).mockServiceWorker =
	mockServiceWorker;

Object.defineProperty(navigator, 'onLine', {
	value: true,
	writable: true
});

global.fetch = vi.fn();

vi.mock('$app/env', () => ({
	browser: true,
	dev: false,
	building: false,
	version: '1.0.0'
}));

(global as unknown as { browser: boolean }).browser = true;
