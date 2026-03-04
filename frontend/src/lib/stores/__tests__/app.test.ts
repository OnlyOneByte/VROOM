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
		// Reset store to initial state
		appStore.clearVehicles();
		appStore.clearNotifications();
		appStore.closeMobileMenu();
		appStore.setLoading(false);
	});

	describe('Initial State', () => {
		it('has correct initial state', () => {
			expect(appStore.vehicles).toEqual([]);
			expect(appStore.selectedVehicle).toBe(null);
			expect(appStore.isMobileMenuOpen).toBe(false);
			expect(appStore.isLoading).toBe(false);
			expect(appStore.notifications).toEqual([]);
		});
	});

	describe('Vehicle Management', () => {
		it('sets vehicles', () => {
			const vehicles = [mockVehicle, mockVehicle2];
			appStore.setVehicles(vehicles);

			// Direct property access on runes store
			expect(appStore.vehicles).toEqual(vehicles);
		});

		it('adds a vehicle', () => {
			appStore.addVehicle(mockVehicle);

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.vehicles[0]).toEqual(mockVehicle);
		});

		it('updates a vehicle', () => {
			appStore.addVehicle(mockVehicle);

			const updatedVehicle = { ...mockVehicle, nickname: 'Updated Car' };
			appStore.updateVehicle(mockVehicle.id, updatedVehicle);

			// Direct property access on runes store
			expect(appStore.vehicles[0]?.nickname).toBe('Updated Car');
		});

		it('removes a vehicle', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.removeVehicle(mockVehicle.id);

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.vehicles[0]?.id).toBe(mockVehicle2.id);
		});

		it('clears all vehicles', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.clearVehicles();

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(0);
		});

		it('selects a vehicle', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			// Direct property access on runes store
			expect(appStore.selectedVehicle).toEqual(mockVehicle);
		});

		it('clears selected vehicle when vehicle not found', () => {
			appStore.setVehicles([mockVehicle]);
			appStore.selectVehicle('nonexistent');

			// Direct property access on runes store
			expect(appStore.selectedVehicle).toBe(null);
		});

		it('clears selected vehicle', () => {
			appStore.setVehicles([mockVehicle]);
			appStore.selectVehicle(mockVehicle.id);
			appStore.clearSelectedVehicle();

			// Direct property access on runes store
			expect(appStore.selectedVehicle).toBe(null);
		});
	});

	describe('Notification Management', () => {
		it('adds a notification', () => {
			appStore.addNotification(mockNotification);

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]).toMatchObject({
				type: mockNotification.type,
				message: mockNotification.message,
				duration: mockNotification.duration
			});
		});

		it('removes a notification', () => {
			appStore.addNotification(mockNotification);

			// Direct property access on runes store
			const notificationId = appStore.notifications[0]?.id;

			if (notificationId) {
				appStore.removeNotification(notificationId);
			}

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(0);
		});

		it('clears all notifications', () => {
			appStore.addNotification(mockNotification);
			appStore.addNotification({ ...mockNotification, message: 'Second notification' });
			appStore.clearNotifications();

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(0);
		});

		it('shows success notification', () => {
			appStore.showSuccess('Success message');

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('success');
			expect(appStore.notifications[0]?.message).toBe('Success message');
		});

		it('shows error notification', () => {
			appStore.showError('Error message');

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('error');
			expect(appStore.notifications[0]?.message).toBe('Error message');
		});

		it('shows warning notification', () => {
			appStore.showWarning('Warning message');

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('warning');
			expect(appStore.notifications[0]?.message).toBe('Warning message');
		});

		it('shows info notification', () => {
			appStore.showInfo('Info message');

			// Direct property access on runes store
			expect(appStore.notifications).toHaveLength(1);
			expect(appStore.notifications[0]?.type).toBe('info');
			expect(appStore.notifications[0]?.message).toBe('Info message');
		});
	});

	describe('Loading State', () => {
		it('sets loading state', () => {
			appStore.setLoading(true);

			// Direct property access on runes store
			expect(appStore.isLoading).toBe(true);

			appStore.setLoading(false);

			// Direct property access on runes store
			expect(appStore.isLoading).toBe(false);
		});
	});

	describe('Mobile Menu', () => {
		it('toggles mobile menu', () => {
			appStore.toggleMobileMenu();

			// Direct property access on runes store
			expect(appStore.isMobileMenuOpen).toBe(true);

			appStore.toggleMobileMenu();

			// Direct property access on runes store
			expect(appStore.isMobileMenuOpen).toBe(false);
		});

		it('opens mobile menu', () => {
			appStore.openMobileMenu();

			// Direct property access on runes store
			expect(appStore.isMobileMenuOpen).toBe(true);
		});

		it('closes mobile menu', () => {
			appStore.openMobileMenu();
			appStore.closeMobileMenu();

			// Direct property access on runes store
			expect(appStore.isMobileMenuOpen).toBe(false);
		});
	});

	describe('Store Reactivity', () => {
		it('reflects state changes immediately', () => {
			// Add vehicle
			appStore.addVehicle(mockVehicle);
			expect(appStore.vehicles).toHaveLength(1);

			// Set loading
			appStore.setLoading(true);
			expect(appStore.isLoading).toBe(true);

			// Toggle mobile menu
			appStore.toggleMobileMenu();
			expect(appStore.isMobileMenuOpen).toBe(true);

			// Add notification
			appStore.showSuccess('Test');
			expect(appStore.notifications).toHaveLength(1);
		});
	});

	describe('Complex State Updates', () => {
		it('handles multiple vehicle operations', () => {
			// Add multiple vehicles
			appStore.setVehicles([mockVehicle, mockVehicle2]);

			// Select one
			appStore.selectVehicle(mockVehicle.id);

			// Update the selected vehicle
			const updatedVehicle = { ...mockVehicle, nickname: 'Updated' };
			appStore.updateVehicle(mockVehicle.id, updatedVehicle);

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(2);
			expect(appStore.selectedVehicle?.nickname).toBe('Updated');
			expect(appStore.vehicles.find(v => v.id === mockVehicle.id)?.nickname).toBe('Updated');
		});

		it('clears selected vehicle when it is removed', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			// Remove the selected vehicle
			appStore.removeVehicle(mockVehicle.id);

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.selectedVehicle).toBe(null);
		});

		it('maintains selected vehicle when other vehicles are removed', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			// Remove a different vehicle
			appStore.removeVehicle(mockVehicle2.id);

			// Direct property access on runes store
			expect(appStore.vehicles).toHaveLength(1);
			expect(appStore.selectedVehicle?.id).toBe(mockVehicle.id);
		});
	});
});
