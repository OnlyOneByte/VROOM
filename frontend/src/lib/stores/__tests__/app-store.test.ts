/**
 * C342 (guard) — pin appStore, the global vehicle-list + notification (toast) store.
 *
 * stores/app.svelte.ts had ZERO direct test coverage. It backs the app-wide vehicle list (every
 * vehicle CRUD surface reads/writes it) and the toast notification system (showSuccess/Error/Warning/
 * Info → addNotification). The load-bearing logic a refactor could silently break:
 *   - updateVehicle does an ID-MATCH map (only the matching vehicle changes; a non-match is a no-op);
 *     removeVehicle is an ID filter — get either predicate wrong and the wrong vehicle mutates/vanishes.
 *   - addNotification assigns a fresh id + stamps a timestamp + defaults duration to 5000.
 *   - the four show* helpers carry DISTINCT default toast lifetimes (success 5000 / error 8000 /
 *     warning 6000 / info 5000) — these are the user-facing dismiss timings; a regression that
 *     flattened them would make errors vanish too fast (or infos linger).
 * reset() clears state; the store is a singleton so each test resets first.
 * NON-VACUOUS: flip an updateVehicle/removeVehicle predicate, or change a default duration, → RED.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { appStore } from '../app.svelte';
import type { Vehicle } from '$lib/types';

function vehicle(id: string, over: Partial<Vehicle> = {}): Vehicle {
	return { id, userId: 'u1', make: 'Toyota', model: 'Camry', year: 2022, ...over } as Vehicle;
}

beforeEach(() => {
	appStore.reset();
});

describe('appStore — vehicle CRUD', () => {
	test('setVehicles / addVehicle / clearVehicles', () => {
		appStore.setVehicles([vehicle('a'), vehicle('b')]);
		expect(appStore.vehicles.map((v) => v.id)).toEqual(['a', 'b']);
		appStore.addVehicle(vehicle('c'));
		expect(appStore.vehicles.map((v) => v.id)).toEqual(['a', 'b', 'c']);
		appStore.clearVehicles();
		expect(appStore.vehicles).toEqual([]);
	});

	test('updateVehicle changes ONLY the id-matched vehicle, merging the partial', () => {
		appStore.setVehicles([vehicle('a', { make: 'Honda' }), vehicle('b', { make: 'Mazda' })]);
		appStore.updateVehicle('b', { model: 'CX-5' });
		expect(appStore.vehicles.find((v) => v.id === 'a')?.make).toBe('Honda'); // untouched
		const b = appStore.vehicles.find((v) => v.id === 'b');
		expect(b?.make).toBe('Mazda'); // preserved
		expect(b?.model).toBe('CX-5'); // merged
	});

	test('updateVehicle for an unknown id is a no-op (no row added, none mutated)', () => {
		appStore.setVehicles([vehicle('a')]);
		appStore.updateVehicle('nope', { make: 'Ford' });
		expect(appStore.vehicles).toHaveLength(1);
		expect(appStore.vehicles[0]?.make).toBe('Toyota');
	});

	test('removeVehicle drops only the id-matched vehicle', () => {
		appStore.setVehicles([vehicle('a'), vehicle('b'), vehicle('c')]);
		appStore.removeVehicle('b');
		expect(appStore.vehicles.map((v) => v.id)).toEqual(['a', 'c']);
	});
});

describe('appStore — notifications', () => {
	test('addNotification assigns an id + timestamp and defaults duration to 5000', () => {
		appStore.addNotification({ type: 'info', message: 'hi' });
		expect(appStore.notifications).toHaveLength(1);
		const n = appStore.notifications[0]!;
		expect(typeof n.id).toBe('string');
		expect(n.id.length).toBeGreaterThan(0);
		expect(n.duration).toBe(5000);
		expect(typeof n.timestamp).toBe('number');
	});

	test('an explicit duration is honored over the default', () => {
		appStore.addNotification({ type: 'info', message: 'hi', duration: 1234 });
		expect(appStore.notifications[0]!.duration).toBe(1234);
	});

	test('removeNotification drops by id; clearNotifications empties', () => {
		appStore.addNotification({ type: 'info', message: 'one' });
		appStore.addNotification({ type: 'error', message: 'two' });
		const firstId = appStore.notifications[0]!.id;
		appStore.removeNotification(firstId);
		expect(appStore.notifications.map((n) => n.message)).toEqual(['two']);
		appStore.clearNotifications();
		expect(appStore.notifications).toEqual([]);
	});

	test('the four show* helpers carry their distinct default toast lifetimes', () => {
		appStore.showSuccess('s');
		appStore.showError('e');
		appStore.showWarning('w');
		appStore.showInfo('i');
		const byType: Record<string, number | undefined> = Object.fromEntries(
			appStore.notifications.map((n) => [n.type, n.duration])
		);
		expect(byType['success']).toBe(5000);
		expect(byType['error']).toBe(8000); // errors linger longest
		expect(byType['warning']).toBe(6000);
		expect(byType['info']).toBe(5000);
	});

	test('show* still honors an explicit duration override', () => {
		appStore.showError('e', 2000);
		expect(appStore.notifications[0]!.duration).toBe(2000);
	});
});

describe('appStore — loading + reset', () => {
	test('setLoading toggles isLoading', () => {
		expect(appStore.isLoading).toBe(false);
		appStore.setLoading(true);
		expect(appStore.isLoading).toBe(true);
	});

	test('reset clears vehicles, notifications, and loading', () => {
		appStore.setVehicles([vehicle('a')]);
		appStore.addNotification({ type: 'info', message: 'x' });
		appStore.setLoading(true);
		appStore.reset();
		expect(appStore.vehicles).toEqual([]);
		expect(appStore.notifications).toEqual([]);
		expect(appStore.isLoading).toBe(false);
	});
});
