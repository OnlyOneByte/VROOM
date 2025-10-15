// Custom service worker for VROOM Car Tracker
// This extends the Workbox service worker with background sync

const CACHE_NAME = 'vroom-v1';
const OFFLINE_EXPENSES_STORE = 'offline-expenses';

// Install event
self.addEventListener('install', event => {
	console.log('Service Worker installing');
	self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
	console.log('Service Worker activating');
	event.waitUntil(self.clients.claim());
});

// Background sync event
self.addEventListener('sync', event => {
	console.log('Background sync triggered:', event.tag);

	if (event.tag === 'expense-sync') {
		event.waitUntil(syncOfflineExpenses());
	}
});

// Sync offline expenses
async function syncOfflineExpenses() {
	try {
		// Get offline expenses from IndexedDB or localStorage
		const offlineExpenses = await getOfflineExpenses();

		if (offlineExpenses.length === 0) {
			return;
		}

		// Attempt to sync each expense
		for (const expense of offlineExpenses) {
			try {
				const response = await fetch(`/api/vehicles/${expense.vehicleId}/expenses`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						type: expense.type,
						category: expense.category,
						amount: expense.amount,
						date: expense.date,
						mileage: expense.mileage,
						gallons: expense.gallons,
						description: expense.description
					})
				});

				if (response.ok) {
					// Mark expense as synced
					await markExpenseAsSynced(expense.id);
				}
			} catch (error) {
				console.error('Failed to sync expense:', expense.id, error);
			}
		}

		// Notify clients that sync is complete
		const clients = await self.clients.matchAll();
		clients.forEach(client => {
			client.postMessage({
				type: 'SYNC_COMPLETE',
				timestamp: Date.now()
			});
		});
	} catch (error) {
		console.error('Background sync failed:', error);
	}
}

// Get offline expenses from storage
async function getOfflineExpenses() {
	try {
		// Try to get from IndexedDB first, fallback to localStorage
		if ('indexedDB' in self) {
			return await getFromIndexedDB();
		} else {
			return getFromLocalStorage();
		}
	} catch (error) {
		console.error('Failed to get offline expenses:', error);
		return [];
	}
}

// Get from IndexedDB
async function getFromIndexedDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('vroom-offline', 1);

		request.onerror = () => reject(request.error);

		request.onsuccess = () => {
			const db = request.result;
			const transaction = db.transaction([OFFLINE_EXPENSES_STORE], 'readonly');
			const store = transaction.objectStore(OFFLINE_EXPENSES_STORE);
			const getAllRequest = store.getAll();

			getAllRequest.onsuccess = () => {
				const expenses = getAllRequest.result.filter(expense => !expense.synced);
				resolve(expenses);
			};

			getAllRequest.onerror = () => reject(getAllRequest.error);
		};

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(OFFLINE_EXPENSES_STORE)) {
				db.createObjectStore(OFFLINE_EXPENSES_STORE, { keyPath: 'id' });
			}
		};
	});
}

// Get from localStorage (fallback)
function getFromLocalStorage() {
	try {
		const stored = localStorage.getItem('vroom_offline_expenses');
		const expenses = stored ? JSON.parse(stored) : [];
		return expenses.filter(expense => !expense.synced);
	} catch (error) {
		console.error('Failed to get from localStorage:', error);
		return [];
	}
}

// Mark expense as synced
async function markExpenseAsSynced(expenseId) {
	try {
		if ('indexedDB' in self) {
			await markSyncedInIndexedDB(expenseId);
		} else {
			markSyncedInLocalStorage(expenseId);
		}
	} catch (error) {
		console.error('Failed to mark expense as synced:', error);
	}
}

// Mark synced in IndexedDB
async function markSyncedInIndexedDB(expenseId) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('vroom-offline', 1);

		request.onsuccess = () => {
			const db = request.result;
			const transaction = db.transaction([OFFLINE_EXPENSES_STORE], 'readwrite');
			const store = transaction.objectStore(OFFLINE_EXPENSES_STORE);

			const getRequest = store.get(expenseId);
			getRequest.onsuccess = () => {
				const expense = getRequest.result;
				if (expense) {
					expense.synced = true;
					const putRequest = store.put(expense);
					putRequest.onsuccess = () => resolve();
					putRequest.onerror = () => reject(putRequest.error);
				} else {
					resolve();
				}
			};

			getRequest.onerror = () => reject(getRequest.error);
		};

		request.onerror = () => reject(request.error);
	});
}

// Mark synced in localStorage (fallback)
function markSyncedInLocalStorage(expenseId) {
	try {
		const stored = localStorage.getItem('vroom_offline_expenses');
		const expenses = stored ? JSON.parse(stored) : [];

		const updatedExpenses = expenses.map(expense =>
			expense.id === expenseId ? { ...expense, synced: true } : expense
		);

		localStorage.setItem('vroom_offline_expenses', JSON.stringify(updatedExpenses));
	} catch (error) {
		console.error('Failed to mark synced in localStorage:', error);
	}
}
