import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../app.svelte';
import type { Vehicle, Notification } from '../../types/index.js';

// Mock vehicle data
const mockVehicle: Vehicle = {
	id: '1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas' as const,
	trackFuel: true,
	trackCharging: false,
	licensePlate: 'ABC123',
	nickname: 'My Car',
	initialMileage: 50000,
	purchasePrice: 25000,
	purchaseDate: '2020-01-01',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

const mockVehicle2: Vehicle = {
	id: '2',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'gas' as const,
	trackFuel: true,
	trackCharging: false,
	licensePlate: 'XYZ789',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

const mockNotification: Notification = {
	id: '1',
	type: 'success',
	message: 'Test notification',
	duration: 5000,
	timestamp: Date.now()
};

describe('App Store', () => {
	beforeEach(() => {
		appStore.clearVehicles();
		appStore.clearNotifications();
		appStore.setLoading(false);
	});

	describe('Initial State', () => {
		it('has correct initial state', () => {
			expect(appStore.vehicles).toEqual([]);
			expect(appStore.isLoading).toBe(false);
			expect(appStore.notifications).toEqual([]);
		});
	});

	describe('Vehicle Management', () => {
		it('sets vehicles', () => {
			const vehicles = [mockVehicle, mockVehicle2];
			appStore.setVehicles(vehicles);
			expect(appStore.vehicles).toEqual(vehicles);
		});

		it('adds a vehicle', () => {
			appStore.addVehicle(mockVehicle);
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.vehicles[0]).toEqual(mockVehicle);
		});

		it('updates a vehicle', () => {
			appStore.addVehicle(mockVehicle);
			appStore.updateVehicle(mockVehicle.id, { nickname: 'Updated Car' });
			expect(appStore.vehicles[0]?.nickname).toBe('Updated Car');
		});

		it('removes a vehicle', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.removeVehicle(mockVehicle.id);
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.vehicles[0]?.id).toBe(mockVehicle2.id);
		});

		it('clears all vehicles', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.clearVehicles();
			expect(appStore.vehicles).toHaveLength(0);
		});
	});

	describe('Notification Management', () => {
		it('adds a notification', () => {
			appStore.addNotification(mockNotification);
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]).toMatchObject({
				type: mockNotification.type,
				message: mockNotification.message,
				duration: mockNotification.duration
			});
		});

		it('removes a notification', () => {
			appStore.addNotification(mockNotification);
			const notificationId = appStore.notifications[0]?.id;
			if (notificationId) {
				appStore.removeNotification(notificationId);
			}
			expect(appStore.notifications).toHaveLength(0);
		});

		it('clears all notifications', () => {
			appStore.addNotification(mockNotification);
			appStore.addNotification({ ...mockNotification, message: 'Second notification' });
			appStore.clearNotifications();
			expect(appStore.notifications).toHaveLength(0);
		});

		it('shows success notification', () => {
			appStore.showSuccess('Success message');
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('success');
			expect(appStore.notifications[0]?.message).toBe('Success message');
		});

		it('shows error notification', () => {
			appStore.showError('Error message');
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('error');
			expect(appStore.notifications[0]?.message).toBe('Error message');
		});

		it('shows warning notification', () => {
			appStore.showWarning('Warning message');
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('warning');
			expect(appStore.notifications[0]?.message).toBe('Warning message');
		});

		it('shows info notification', () => {
			appStore.showInfo('Info message');
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('info');
			expect(appStore.notifications[0]?.message).toBe('Info message');
		});
	});

	describe('Loading State', () => {
		it('sets loading state', () => {
			appStore.setLoading(true);
			expect(appStore.isLoading).toBe(true);
			appStore.setLoading(false);
			expect(appStore.isLoading).toBe(false);
		});
	});

	describe('Store Reactivity', () => {
		it('reflects state changes immediately', () => {
			appStore.addVehicle(mockVehicle);
			expect(appStore.vehicles).toHaveLength(1);

			appStore.setLoading(true);
			expect(appStore.isLoading).toBe(true);

			appStore.showSuccess('Test');
			expect(appStore.notifications).toHaveLength(1);
		});
	});

	describe('Complex State Updates', () => {
		it('handles multiple vehicle operations', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.updateVehicle(mockVehicle.id, { nickname: 'Updated' });
			expect(appStore.vehicles).toHaveLength(2);
			expect(appStore.vehicles.find(v => v.id === mockVehicle.id)?.nickname).toBe('Updated');
		});
	});
});
