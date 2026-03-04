import type { Vehicle, AppState, Notification } from '../types/index.js';

const initialState: AppState = {
	vehicles: [],
	selectedVehicle: null,
	isMobileMenuOpen: false,
	isLoading: false,
	notifications: []
};

function createAppStore() {
	let state = $state<AppState>({ ...initialState });

	return {
		get vehicles() {
			return state.vehicles;
		},
		get selectedVehicle() {
			return state.selectedVehicle;
		},
		get isMobileMenuOpen() {
			return state.isMobileMenuOpen;
		},
		get isLoading() {
			return state.isLoading;
		},
		get notifications() {
			return state.notifications;
		},

		// Vehicle management
		setVehicles(vehicles: Vehicle[]) {
			state.vehicles = vehicles;
		},

		addVehicle(vehicle: Vehicle) {
			state.vehicles = [...state.vehicles, vehicle];
		},

		updateVehicle(vehicleId: string, updates: Partial<Vehicle>) {
			state.vehicles = state.vehicles.map(v => (v.id === vehicleId ? { ...v, ...updates } : v));
			if (state.selectedVehicle?.id === vehicleId) {
				state.selectedVehicle = { ...state.selectedVehicle, ...updates };
			}
		},

		removeVehicle(vehicleId: string) {
			state.vehicles = state.vehicles.filter(v => v.id !== vehicleId);
			if (state.selectedVehicle?.id === vehicleId) {
				state.selectedVehicle = null;
			}
		},

		selectVehicle(vehicleId: string) {
			state.selectedVehicle = state.vehicles.find(v => v.id === vehicleId) || null;
		},

		clearSelectedVehicle() {
			state.selectedVehicle = null;
		},

		clearVehicles() {
			state.vehicles = [];
			state.selectedVehicle = null;
		},

		// UI state management
		toggleMobileMenu() {
			state.isMobileMenuOpen = !state.isMobileMenuOpen;
		},

		openMobileMenu() {
			state.isMobileMenuOpen = true;
		},

		closeMobileMenu() {
			state.isMobileMenuOpen = false;
		},

		setLoading(isLoading: boolean) {
			state.isLoading = isLoading;
		},

		// Notification system
		addNotification(notification: Omit<Notification, 'id'>) {
			const newNotification: Notification = {
				...notification,
				id: crypto.randomUUID(),
				duration: notification.duration ?? 5000,
				timestamp: Date.now()
			};
			state.notifications = [...state.notifications, newNotification];
		},

		removeNotification(id: string) {
			state.notifications = state.notifications.filter(n => n.id !== id);
		},

		clearNotifications() {
			state.notifications = [];
		},

		showSuccess(message: string, duration?: number) {
			this.addNotification({ type: 'success', message, duration: duration ?? 5000 });
		},

		showError(message: string, duration?: number) {
			this.addNotification({ type: 'error', message, duration: duration ?? 8000 });
		},

		showWarning(message: string, duration?: number) {
			this.addNotification({ type: 'warning', message, duration: duration ?? 6000 });
		},

		showInfo(message: string, duration?: number) {
			this.addNotification({ type: 'info', message, duration: duration ?? 5000 });
		},

		reset() {
			state = { ...initialState };
		}
	};
}

export const appStore = createAppStore();
