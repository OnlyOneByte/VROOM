import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { appStore } from '../app.js';
import type { Vehicle, Notification } from '../../types/index.js';

// Mock vehicle data
const mockVehicle: Vehicle = {
	id: '1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas' as const,
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
			const state = get(appStore);
			expect(state).toEqual({
				vehicles: [],
				selectedVehicle: null,
				notifications: [],
				isLoading: false,
				isMobileMenuOpen: false
			});
		});
	});

	describe('Vehicle Management', () => {
		it('sets vehicles', () => {
			const vehicles = [mockVehicle, mockVehicle2];
			appStore.setVehicles(vehicles);

			const state = get(appStore);
			expect(state.vehicles).toEqual(vehicles);
		});

		it('adds a vehicle', () => {
			appStore.addVehicle(mockVehicle);

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(1);
			expect(state.vehicles[0]).toEqual(mockVehicle);
		});

		it('updates a vehicle', () => {
			appStore.addVehicle(mockVehicle);

			const updatedVehicle = { ...mockVehicle, nickname: 'Updated Car' };
			appStore.updateVehicle(mockVehicle.id, updatedVehicle);

			const state = get(appStore);
			expect(state.vehicles[0]?.nickname).toBe('Updated Car');
		});

		it('removes a vehicle', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.removeVehicle(mockVehicle.id);

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(1);
			expect(state.vehicles[0]?.id).toBe(mockVehicle2.id);
		});

		it('clears all vehicles', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.clearVehicles();

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(0);
		});

		it('selects a vehicle', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			const state = get(appStore);
			expect(state.selectedVehicle).toEqual(mockVehicle);
		});

		it('clears selected vehicle when vehicle not found', () => {
			appStore.setVehicles([mockVehicle]);
			appStore.selectVehicle('nonexistent');

			const state = get(appStore);
			expect(state.selectedVehicle).toBe(null);
		});

		it('clears selected vehicle', () => {
			appStore.setVehicles([mockVehicle]);
			appStore.selectVehicle(mockVehicle.id);
			appStore.clearSelectedVehicle();

			const state = get(appStore);
			expect(state.selectedVehicle).toBe(null);
		});
	});

	describe('Notification Management', () => {
		it('adds a notification', () => {
			appStore.addNotification(mockNotification);

			const state = get(appStore);
			expect(state.notifications).toHaveLength(1);
			expect(state.notifications[0]).toMatchObject({
				type: mockNotification.type,
				message: mockNotification.message,
				duration: mockNotification.duration
			});
		});

		it('removes a notification', () => {
			appStore.addNotification(mockNotification);

			const state = get(appStore);
			const notificationId = state.notifications[0]?.id;

			if (notificationId) {
				appStore.removeNotification(notificationId);
			}

			const updatedState = get(appStore);
			expect(updatedState.notifications).toHaveLength(0);
		});

		it('clears all notifications', () => {
			appStore.addNotification(mockNotification);
			appStore.addNotification({ ...mockNotification, message: 'Second notification' });
			appStore.clearNotifications();

			const state = get(appStore);
			expect(state.notifications).toHaveLength(0);
		});

		it('shows success notification', () => {
			appStore.showSuccess('Success message');

			const state = get(appStore);
			expect(state.notifications).toHaveLength(1);
			expect(state.notifications[0]?.type).toBe('success');
			expect(state.notifications[0]?.message).toBe('Success message');
		});

		it('shows error notification', () => {
			appStore.showError('Error message');

			const state = get(appStore);
			expect(state.notifications).toHaveLength(1);
			expect(state.notifications[0]?.type).toBe('error');
			expect(state.notifications[0]?.message).toBe('Error message');
		});

		it('shows warning notification', () => {
			appStore.showWarning('Warning message');

			const state = get(appStore);
			expect(state.notifications).toHaveLength(1);
			expect(state.notifications[0]?.type).toBe('warning');
			expect(state.notifications[0]?.message).toBe('Warning message');
		});

		it('shows info notification', () => {
			appStore.showInfo('Info message');

			const state = get(appStore);
			expect(state.notifications).toHaveLength(1);
			expect(state.notifications[0]?.type).toBe('info');
			expect(state.notifications[0]?.message).toBe('Info message');
		});
	});

	describe('Loading State', () => {
		it('sets loading state', () => {
			appStore.setLoading(true);

			const state = get(appStore);
			expect(state.isLoading).toBe(true);

			appStore.setLoading(false);

			const updatedState = get(appStore);
			expect(updatedState.isLoading).toBe(false);
		});
	});

	describe('Mobile Menu', () => {
		it('toggles mobile menu', () => {
			appStore.toggleMobileMenu();

			const state = get(appStore);
			expect(state.isMobileMenuOpen).toBe(true);

			appStore.toggleMobileMenu();

			const updatedState = get(appStore);
			expect(updatedState.isMobileMenuOpen).toBe(false);
		});

		it('opens mobile menu', () => {
			appStore.openMobileMenu();

			const state = get(appStore);
			expect(state.isMobileMenuOpen).toBe(true);
		});

		it('closes mobile menu', () => {
			appStore.openMobileMenu();
			appStore.closeMobileMenu();

			const state = get(appStore);
			expect(state.isMobileMenuOpen).toBe(false);
		});
	});

	describe('Store Reactivity', () => {
		it('notifies subscribers of state changes', () => {
			const states: any[] = [];

			const unsubscribe = appStore.subscribe(state => {
				states.push({ ...state });
			});

			// Initial state
			expect(states).toHaveLength(1);

			// Add vehicle
			appStore.addVehicle(mockVehicle);
			expect(states).toHaveLength(2);
			expect(states[1].vehicles).toHaveLength(1);

			// Set loading
			appStore.setLoading(true);
			expect(states).toHaveLength(3);
			expect(states[2].isLoading).toBe(true);

			// Toggle mobile menu
			appStore.toggleMobileMenu();
			expect(states).toHaveLength(4);
			expect(states[3].isMobileMenuOpen).toBe(true);

			// Add notification
			appStore.showSuccess('Test');
			expect(states).toHaveLength(5);
			expect(states[4].notifications).toHaveLength(1);

			unsubscribe();
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

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(2);
			expect(state.selectedVehicle?.nickname).toBe('Updated');
			expect(state.vehicles.find(v => v.id === mockVehicle.id)?.nickname).toBe('Updated');
		});

		it('clears selected vehicle when it is removed', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			// Remove the selected vehicle
			appStore.removeVehicle(mockVehicle.id);

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(1);
			expect(state.selectedVehicle).toBe(null);
		});

		it('maintains selected vehicle when other vehicles are removed', () => {
			appStore.setVehicles([mockVehicle, mockVehicle2]);
			appStore.selectVehicle(mockVehicle.id);

			// Remove a different vehicle
			appStore.removeVehicle(mockVehicle2.id);

			const state = get(appStore);
			expect(state.vehicles).toHaveLength(1);
			expect(state.selectedVehicle?.id).toBe(mockVehicle.id);
		});
	});
});
