import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { animateOnView } from '../animate-on-view';

type FrameCallback = (time: number) => void;
type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

const observer = {
	callback: null as ObserverCallback | null,
	options: undefined as { threshold: number } | undefined,
	observed: null as Element | null,
	disconnect: vi.fn()
};

class FakeIntersectionObserver {
	constructor(callback: ObserverCallback, options?: { threshold: number }) {
		observer.callback = callback;
		observer.options = options;
	}
	observe(target: Element) {
		observer.observed = target;
	}
	disconnect() {
		observer.disconnect();
	}
}

let frames: Map<number, FrameCallback>;
let nextFrameId: number;
const cancelAnimationFrameMock = vi.fn((id: number) => {
	frames.delete(id);
});

function runFrame() {
	const pending = [...frames.entries()];
	frames.clear();
	for (const [, callback] of pending) callback(0);
}

function intersect(isIntersecting: boolean) {
	observer.callback?.([{ isIntersecting }]);
}

describe('animateOnView', () => {
	beforeEach(() => {
		frames = new Map();
		nextFrameId = 1;
		observer.callback = null;
		observer.observed = null;
		observer.disconnect.mockClear();
		cancelAnimationFrameMock.mockClear();
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameCallback) => {
			const id = nextFrameId++;
			frames.set(id, callback);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('observes the node at a 15% threshold', () => {
		const node = document.createElement('div');

		animateOnView(node, 'in-view');

		expect(observer.observed).toBe(node);
		expect(observer.options).toEqual({ threshold: 0.15 });
	});

	test('adds the class two frames after the node enters the viewport', () => {
		const node = document.createElement('div');
		animateOnView(node, 'in-view');

		intersect(true);
		runFrame();
		expect(node.classList.contains('in-view')).toBe(false);

		runFrame();
		expect(node.classList.contains('in-view')).toBe(true);
	});

	test('removes the class when the node leaves without a pending frame', () => {
		const node = document.createElement('div');
		animateOnView(node, 'in-view');
		intersect(true);
		runFrame();
		runFrame();

		intersect(false);

		expect(node.classList.contains('in-view')).toBe(false);
		expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
	});

	test('cancels the pending frame when the node leaves before the class is added', () => {
		const node = document.createElement('div');
		animateOnView(node, 'in-view');
		intersect(true);

		intersect(false);
		runFrame();
		runFrame();

		expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(1);
		expect(node.classList.contains('in-view')).toBe(false);
	});

	test('destroy cancels a pending frame and disconnects the observer', () => {
		const node = document.createElement('div');
		const action = animateOnView(node, 'in-view');
		intersect(true);

		action.destroy();
		runFrame();
		runFrame();

		expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(1);
		expect(observer.disconnect).toHaveBeenCalledTimes(1);
		expect(node.classList.contains('in-view')).toBe(false);
	});

	test('destroy only disconnects when no frame is pending', () => {
		const node = document.createElement('div');
		const action = animateOnView(node, 'in-view');

		action.destroy();

		expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
		expect(observer.disconnect).toHaveBeenCalledTimes(1);
	});
});
