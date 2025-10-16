import { writable } from 'svelte/store';
import type { Vehicle, AppState, Notification } from '../types/index.js';

const initialState: AppState = {
	vehicles: [],
	selectedVehicle: null,
	isMobileMenuOpen: false,
	isLoading: false,
	notifications: []
};

function createAppStore() {
	const { subscribe, set, update } = writable<AppState>(initialState);

	return {
		subscribe,

		// Vehicle management
		setVehicles: (vehicles: Vehicle[]) => {
			update(state => ({ ...state, vehicles }));
		},

		addVehicle: (vehicle: Vehicle) => {
			update(state => ({
				...state,
				vehicles: [...state.vehicles, vehicle]
			}));
		},

		updateVehicle: (vehicleId: string, updates: Partial<Vehicle>) => {
			update(state => ({
				...state,
				vehicles: state.vehicles.map(v => (v.id === vehicleId ? { ...v, ...updates } : v)),
				selectedVehicle:
					state.selectedVehicle?.id === vehicleId
						? { ...state.selectedVehicle, ...updates }
						: state.selectedVehicle
			}));
		},

		removeVehicle: (vehicleId: string) => {
			update(state => ({
				...state,
				vehicles: state.vehicles.filter(v => v.id !== vehicleId),
				selectedVehicle: state.selectedVehicle?.id === vehicleId ? null : state.selectedVehicle
			}));
		},

		selectVehicle: (vehicleId: string) => {
			update(state => {
				const vehicle = state.vehicles.find(v => v.id === vehicleId);
				return { ...state, selectedVehicle: vehicle || null };
			});
		},

		clearSelectedVehicle: () => {
			update(state => ({ ...state, selectedVehicle: null }));
		},

		clearVehicles: () => {
			update(state => ({
				...state,
				vehicles: [],
				selectedVehicle: null
			}));
		},

		// UI state management
		toggleMobileMenu: () => {
			update(state => ({
				...state,
				isMobileMenuOpen: !state.isMobileMenuOpen
			}));
		},

		openMobileMenu: () => {
			update(state => ({ ...state, isMobileMenuOpen: true }));
		},

		closeMobileMenu: () => {
			update(state => ({ ...state, isMobileMenuOpen: false }));
		},

		setLoading: (isLoading: boolean) => {
			update(state => ({ ...state, isLoading }));
		},

		// Notification system
		addNotification: (notification: Omit<Notification, 'id'>) => {
			const id = crypto.randomUUID();
			const newNotification: Notification = {
				...notification,
				id,
				duration: notification.duration ?? 5000,
				timestamp: Date.now()
			};

			update(state => ({
				...state,
				notifications: [...state.notifications, newNotification]
			}));
		},

		removeNotification: (id: string) => {
			update(state => ({
				...state,
				notifications: state.notifications.filter(n => n.id !== id)
			}));
		},

		clearNotifications: () => {
			update(state => ({ ...state, notifications: [] }));
		},

		// Convenience methods for common notification types
		showSuccess: (message: string, duration?: number) => {
			const id = crypto.randomUUID();
			const notification: Notification = {
				id,
				type: 'success',
				message,
				duration: duration ?? 5000,
				timestamp: Date.now()
			};

			update(state => ({
				...state,
				notifications: [...state.notifications, notification]
			}));
		},

		showError: (message: string, duration?: number) => {
			const id = crypto.randomUUID();
			const notification: Notification = {
				id,
				type: 'error',
				message,
				duration: duration ?? 8000,
				timestamp: Date.now()
			};

			update(state => ({
				...state,
				notifications: [...state.notifications, notification]
			}));
		},

		showWarning: (message: string, duration?: number) => {
			const id = crypto.randomUUID();
			const notification: Notification = {
				id,
				type: 'warning',
				message,
				duration: duration ?? 6000,
				timestamp: Date.now()
			};

			update(state => ({
				...state,
				notifications: [...state.notifications, notification]
			}));
		},

		showInfo: (message: string, duration?: number) => {
			const id = crypto.randomUUID();
			const notification: Notification = {
				id,
				type: 'info',
				message,
				duration: duration ?? 5000,
				timestamp: Date.now()
			};

			update(state => ({
				...state,
				notifications: [...state.notifications, notification]
			}));
		},

		// Reset state (on logout)
		reset: () => {
			set(initialState);
		}
	};
}

export const appStore = createAppStore();
