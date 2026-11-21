import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/env', () => ({
	get browser() {
		return env.browser;
	}
}));

import { createVisibilityWatch, type VisibilityWatchResult } from '../visibility-watch.svelte';

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

const intersection = { callback: null as ObserverCallback | null, disconnect: vi.fn() };
const mutation = {
	callback: null as (() => void) | null,
	target: null as Node | null,
	disconnect: vi.fn()
};

class FakeIntersectionObserver {
	constructor(callback: ObserverCallback) {
		intersection.callback = callback;
	}
	observe() {}
	disconnect() {
		intersection.disconnect();
	}
}

class FakeMutationObserver {
	constructor(callback: () => void) {
		mutation.callback = callback;
	}
	observe(target: Node) {
		mutation.target = target;
	}
	disconnect() {
		mutation.disconnect();
	}
}

function setRendered(node: HTMLElement, rendered: boolean) {
	Object.defineProperty(node, 'offsetParent', {
		configurable: true,
		get: () => (rendered ? document.body : null)
	});
}

let destroyRoot: (() => void) | null = null;

function mountWatch(node: HTMLDivElement | undefined): VisibilityWatchResult {
	let watch!: VisibilityWatchResult;
	destroyRoot = $effect.root(() => {
		watch = createVisibilityWatch();
		watch.el = node;
	});
	flushSync();
	return watch;
}

describe('createVisibilityWatch', () => {
	beforeEach(() => {
		env.browser = true;
		intersection.callback = null;
		mutation.callback = null;
		mutation.target = null;
		intersection.disconnect.mockClear();
		mutation.disconnect.mockClear();
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
		vi.stubGlobal('MutationObserver', FakeMutationObserver);
	});

	afterEach(() => {
		destroyRoot?.();
		destroyRoot = null;
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	test('stays hidden and observes nothing without an element', () => {
		const watch = mountWatch(undefined);

		expect(watch.visible).toBe(false);
		expect(watch.el).toBeUndefined();
		expect(intersection.callback).toBeNull();
	});

	test('stays hidden and observes nothing outside the browser', () => {
		env.browser = false;
		const node = document.createElement('div');

		const watch = mountWatch(node);

		expect(watch.visible).toBe(false);
		expect(intersection.callback).toBeNull();
	});

	test('becomes visible when a rendered element intersects the viewport', () => {
		const node = document.createElement('div');
		document.body.append(node);
		setRendered(node, true);
		const watch = mountWatch(node);

		expect(watch.visible).toBe(false);
		expect(mutation.callback).toBeNull();

		intersection.callback?.([{ isIntersecting: true }]);

		expect(watch.visible).toBe(true);
	});

	test('ignores entries that are not intersecting or belong to an unrendered element', () => {
		const node = document.createElement('div');
		document.body.append(node);
		setRendered(node, false);
		const watch = mountWatch(node);

		intersection.callback?.([{ isIntersecting: false }]);
		intersection.callback?.([{ isIntersecting: true }]);

		expect(watch.visible).toBe(false);
	});

	test('watches the nearest hidden ancestor and only reveals an element that was seen before', () => {
		const panel = document.createElement('section');
		panel.setAttribute('hidden', '');
		const inner = document.createElement('div');
		const node = document.createElement('div');
		panel.append(inner);
		inner.append(node);
		document.body.append(panel);
		setRendered(node, true);
		const watch = mountWatch(node);

		expect(mutation.target).toBe(panel);

		mutation.callback?.();
		expect(watch.visible).toBe(false);

		intersection.callback?.([{ isIntersecting: true }]);
		expect(watch.visible).toBe(true);
	});

	test('resets visibility on re-observe and the mutation watch reveals a previously seen element', () => {
		const panel = document.createElement('section');
		panel.setAttribute('hidden', '');
		const node = document.createElement('div');
		panel.append(node);
		document.body.append(panel);
		setRendered(node, true);
		const watch = mountWatch(node);
		intersection.callback?.([{ isIntersecting: true }]);

		watch.el = undefined;
		flushSync();
		expect(watch.visible).toBe(false);

		watch.el = node;
		flushSync();
		expect(watch.visible).toBe(false);

		setRendered(node, false);
		mutation.callback?.();
		expect(watch.visible).toBe(false);

		setRendered(node, true);
		mutation.callback?.();
		expect(watch.visible).toBe(true);
	});

	test('disconnects both observers when the element changes or the owner is destroyed', () => {
		const panel = document.createElement('section');
		panel.setAttribute('hidden', '');
		const node = document.createElement('div');
		panel.append(node);
		document.body.append(panel);
		const watch = mountWatch(node);

		watch.el = undefined;
		flushSync();

		expect(intersection.disconnect).toHaveBeenCalledTimes(1);
		expect(mutation.disconnect).toHaveBeenCalledTimes(1);

		watch.el = node;
		flushSync();
		destroyRoot?.();
		destroyRoot = null;

		expect(intersection.disconnect).toHaveBeenCalledTimes(2);
		expect(mutation.disconnect).toHaveBeenCalledTimes(2);
	});
});
