import { writable } from 'svelte/store';
import type { Vehicle, Expense } from '../types/index.js';

interface AppState {
	// Vehicle management
	vehicles: Vehicle[];
	selectedVehicle: Vehicle | null;
	
	// UI state
	isMobileMenuOpen: boolean;
	isLoading: boolean;
	
	// Notifications/toasts
	notifications: Notification[];
}

interface Notification {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
}

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
				vehicles: state.vehicles.map(v => 
					v.id === vehicleId ? { ...v, ...updates } : v
				),
				selectedVehicle: state.selectedVehicle?.id === vehicleId 
					? { ...state.selectedVehicle, ...updates }
					: state.selectedVehicle
			}));
		},
		
		removeVehicle: (vehicleId: string) => {
			update(state => ({
				...state,
				vehicles: state.vehicles.filter(v => v.id !== vehicleId),
				selectedVehicle: state.selectedVehicle?.id === vehicleId 
					? null 
					: state.selectedVehicle
			}));
		},
		
		selectVehicle: (vehicle: Vehicle | null) => {
			update(state => ({ ...state, selectedVehicle: vehicle }));
		},
		
		// UI state management
		toggleMobileMenu: () => {
			update(state => ({ 
				...state, 
				isMobileMenuOpen: !state.isMobileMenuOpen 
			}));
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
				duration: notification.duration ?? 5000
			};
			
			update(state => ({
				...state,
				notifications: [...state.notifications, newNotification]
			}));
			
			// Auto-remove notification after duration
			if (newNotification.duration > 0) {
				setTimeout(() => {
					update(state => ({
						...state,
						notifications: state.notifications.filter(n => n.id !== id)
					}));
				}, newNotification.duration);
			}
		},
		
		removeNotification: (id: string) => {
			update(state => ({
				...state,
				notifications: state.notifications.filter(n => n.id !== id)
			}));
		},
		
		// Reset state (on logout)
		reset: () => {
			set(initialState);
		}
	};
}

export const appStore = createAppStore();