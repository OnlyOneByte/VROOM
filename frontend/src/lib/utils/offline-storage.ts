import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import { toBackendExpense } from '#lib/services/api-transformer.ts';
import { browser } from '$app/env';
import type { Expense, ExpenseCategory, Vehicle } from '#lib/types/index.ts';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
const VEHICLE_CACHE_KEY = 'vroom_offline_vehicles';
const VEHICLE_HISTORY_CACHE_KEY = 'vroom_offline_vehicle_history';
const OFFLINE_STORAGE_VERSION = '3.0';
const PHOTO_DB_NAME = 'vroom_offline_photos';
const PHOTO_STORE = 'photos';

export interface OfflineExpense {
	id: string;
	clientId?: string;
	vehicleId: string;
	type?: string;
	tags: string[];
	category: string;
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	volume?: number;
	charge?: number;
	// Must be kept: the sync transform routes charge vs volume solely on this.
	fuelType?: string;
	// Must be kept: a missed fill-up is excluded from MPG pairing.
	missedFillup?: boolean;
	description?: string;
	location?: string;
	sourceType?: string;
	sourceId?: string;
	timestamp: number;
	synced: boolean;
	needsAttention?: boolean;
	attentionReason?: string;
	lastError?: string;
	serverId?: string;
	version?: string;
}

export function offlineExpenseToBackend(
	expense: OfflineExpense,
	options: { clearEmptyFields?: boolean } = {}
): ReturnType<typeof toBackendExpense> {
	return toBackendExpense(
		{
			vehicleId: expense.vehicleId,
			tags: expense.tags,
			category: expense.category as ExpenseCategory,
			amount: expense.amount,
			date: expense.date,
			mileage: expense.mileage,
			volume: expense.volume,
			charge: expense.charge,
			fuelType: expense.fuelType,
			missedFillup: options.clearEmptyFields
				? (expense.missedFillup ?? false)
				: expense.missedFillup,
			description: expense.description,
			location: expense.location,
			sourceType: expense.sourceType,
			sourceId: expense.sourceId
		},
		{ isEdit: options.clearEmptyFields ?? false }
	);
}

export function isIncompleteFuelExpense(expense: OfflineExpense): boolean {
	return expense.category === 'fuel' && ((!expense.volume && !expense.charge) || !expense.mileage);
}

function roundToCents(amount: number): number {
	return Math.round(amount * 100) / 100;
}

export const INCOMPLETE_FUEL_REASON =
	'Fuel expenses require volume/charge and mileage data. Please edit the expense and add the missing information.';

let queueOwner: string | null = null;

function queueStorageKey(owner: string | null = queueOwner): string {
	return owner ? `${OFFLINE_STORAGE_KEY}:${owner}` : OFFLINE_STORAGE_KEY;
}

export function setOfflineQueueOwner(userId: string | null): void {
	if (userId === queueOwner) return;
	queueOwner = userId;
	if (userId) adoptUnscopedQueue();
	offlineExpenseQueue.current = loadOfflineExpenses();
}

function adoptUnscopedQueue(): void {
	if (!browser) return;
	try {
		const unscoped = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (!unscoped) return;
		const adopted: OfflineExpense[] = JSON.parse(unscoped);
		const owned = loadOfflineExpenses();
		const ownedIds = new Set(owned.map(expense => expense.id));
		const merged = [...owned, ...adopted.filter(expense => !ownedIds.has(expense.id))];
		localStorage.setItem(queueStorageKey(), JSON.stringify(merged));
		localStorage.removeItem(OFFLINE_STORAGE_KEY);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to adopt the unscoped offline queue:', error);
	}
}

export function currentOfflineQueueOwner(): string | null {
	return queueOwner;
}

function writeOwnerCache(prefix: string, value: unknown, owner: string | null = queueOwner): void {
	if (!browser || !queueOwner || owner !== queueOwner) return;
	try {
		localStorage.setItem(`${prefix}:${queueOwner}`, JSON.stringify(value));
	} catch (error) {
		if (import.meta.env.DEV) console.error(`Failed to write ${prefix}:`, error);
	}
}

function readOwnerCache<T>(prefix: string): T[] | null {
	if (!browser || !queueOwner) return null;
	try {
		const stored = localStorage.getItem(`${prefix}:${queueOwner}`);
		return stored ? (JSON.parse(stored) as T[]) : null;
	} catch (error) {
		if (import.meta.env.DEV) console.error(`Failed to read ${prefix}:`, error);
		return null;
	}
}

export function cacheVehicles(vehicles: Vehicle[], requestedFor: string | null): void {
	writeOwnerCache(VEHICLE_CACHE_KEY, vehicles, requestedFor);
}

export function loadCachedVehicles(): Vehicle[] {
	return readOwnerCache<Vehicle>(VEHICLE_CACHE_KEY) ?? [];
}

export function updateCachedVehicle(vehicle: Vehicle, requestedFor: string | null): void {
	const cached = readOwnerCache<Vehicle>(VEHICLE_CACHE_KEY);
	if (!cached?.some(v => v.id === vehicle.id)) return;
	writeOwnerCache(
		VEHICLE_CACHE_KEY,
		cached.map(v => (v.id === vehicle.id ? { ...v, ...vehicle } : v)),
		requestedFor
	);
}

export function removeCachedVehicle(vehicleId: string, requestedFor: string | null): void {
	if (requestedFor !== queueOwner) return;
	const cached = readOwnerCache<Vehicle>(VEHICLE_CACHE_KEY);
	if (cached)
		writeOwnerCache(
			VEHICLE_CACHE_KEY,
			cached.filter(v => v.id !== vehicleId)
		);
	if (!browser || !queueOwner) return;
	try {
		localStorage.removeItem(`${VEHICLE_HISTORY_CACHE_KEY}:${vehicleId}:${queueOwner}`);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to clear the vehicle history cache:', error);
	}
}

export function cacheVehicleHistory(
	vehicleId: string,
	expenses: Expense[],
	requestedFor: string | null
): void {
	writeOwnerCache(`${VEHICLE_HISTORY_CACHE_KEY}:${vehicleId}`, expenses, requestedFor);
}

export function loadCachedVehicleHistory(vehicleId: string): Expense[] | null {
	return readOwnerCache<Expense>(`${VEHICLE_HISTORY_CACHE_KEY}:${vehicleId}`);
}

export function clearOfflineCaches(owner: string | null = queueOwner): void {
	if (!browser || !owner) return;
	try {
		const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
		for (const key of keys) {
			if (!key?.endsWith(`:${owner}`)) continue;
			if (
				key.startsWith(`${VEHICLE_CACHE_KEY}:`) ||
				key.startsWith(`${VEHICLE_HISTORY_CACHE_KEY}:`)
			) {
				localStorage.removeItem(key);
			}
		}
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to clear the offline caches:', error);
	}
}

export function loadOfflineExpenses(owner: string | null = queueOwner): OfflineExpense[] {
	if (!browser) return [];

	try {
		const stored = localStorage.getItem(queueStorageKey(owner));
		if (!stored) return [];

		const expenses: OfflineExpense[] = JSON.parse(stored);

		return expenses.map(expense => {
			const amount = roundToCents(expense.amount);
			if (!expense.version || expense.version !== OFFLINE_STORAGE_VERSION) {
				return {
					...expense,
					amount,
					clientId: expense.clientId ?? expense.id,
					version: OFFLINE_STORAGE_VERSION
				};
			}
			return amount === expense.amount ? expense : { ...expense, amount };
		});
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to load offline expenses:', error);
		stashCorruptedBlob(owner);
		return [];
	}
}

function stashCorruptedBlob(owner: string | null): void {
	try {
		const raw = localStorage.getItem(queueStorageKey(owner));
		if (raw) localStorage.setItem(`${queueStorageKey(owner)}.corrupt`, raw);
	} catch {
		// Best-effort: a failed stash must not block startup.
	}
}

export function saveOfflineExpenses(
	expenses: OfflineExpense[],
	owner: string | null = queueOwner
): boolean {
	if (!browser) return false;

	try {
		localStorage.setItem(queueStorageKey(owner), JSON.stringify(expenses));
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline expenses:', error);
		return false;
	}

	if (owner === queueOwner) offlineExpenseQueue.current = expenses;
	return true;
}

export async function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>,
	photos: File[] = [],
	clientId: string = crypto.randomUUID(),
	owner: string | null = queueOwner
): Promise<boolean> {
	const offlineExpense: OfflineExpense = {
		...expense,
		amount: roundToCents(expense.amount),
		id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		clientId,
		timestamp: Date.now(),
		synced: false,
		version: OFFLINE_STORAGE_VERSION
	};

	if (!(await savePendingPhotos(clientId, photos))) return false;

	const currentExpenses = loadOfflineExpenses(owner);
	const queued = saveOfflineExpenses([...currentExpenses, offlineExpense], owner);
	if (!queued && photos.length > 0) await deletePendingPhotos(clientId).catch(() => undefined);
	return queued;
}

function isEditableParked(expense: OfflineExpense): boolean {
	return !expense.synced && !!expense.needsAttention && !expense.serverId;
}

export function findParkedExpense(id: string): OfflineExpense | undefined {
	return loadOfflineExpenses().find(expense => expense.id === id && isEditableParked(expense));
}

export type ReplaceParkedResult = 'saved' | 'not-parked' | 'photos-unreadable' | 'failed';

function sameVehicleAndDay(a: Pick<OfflineExpense, 'vehicleId' | 'date'>, b: typeof a): boolean {
	return a.vehicleId === b.vehicleId && a.date.slice(0, 10) === b.date.slice(0, 10);
}

export async function replaceParkedExpense(
	id: string,
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>,
	photos: File[] | null
): Promise<ReplaceParkedResult> {
	const parked = findParkedExpense(id);
	if (!parked) return 'not-parked';
	if (!parked.clientId && photos?.length) return 'failed';
	const clientId =
		parked.clientId && !sameVehicleAndDay(parked, expense) ? crypto.randomUUID() : parked.clientId;
	const keepsStoredPhotos = photos === null && clientId === parked.clientId;
	const photosToSave =
		photos ??
		(keepsStoredPhotos ? null : await loadPendingPhotos(parked.clientId!).catch(() => null));
	if (!keepsStoredPhotos && photosToSave === null) return 'photos-unreadable';
	const previousPhotos =
		!keepsStoredPhotos && clientId === parked.clientId && clientId
			? await loadPendingPhotos(clientId).catch(() => null)
			: [];
	if (clientId && photosToSave && !(await savePendingPhotos(clientId, photosToSave))) {
		return 'failed';
	}
	const undoPhotos = async () => {
		if (clientId && photosToSave && previousPhotos) {
			await savePendingPhotos(clientId, previousPhotos);
		}
	};

	const currentExpenses = loadOfflineExpenses();
	const existing = currentExpenses.find(entry => entry.id === id);
	if (!existing || !isEditableParked(existing)) {
		await undoPhotos();
		return 'not-parked';
	}
	const replaced: OfflineExpense = {
		...expense,
		amount: roundToCents(expense.amount),
		id: existing.id,
		...(clientId !== undefined && { clientId }),
		timestamp: existing.timestamp,
		synced: false,
		version: OFFLINE_STORAGE_VERSION
	};
	const saved = saveOfflineExpenses(
		currentExpenses.map(entry => (entry.id === id ? replaced : entry))
	);
	if (!saved) {
		await undoPhotos();
		return 'failed';
	}
	if (parked.clientId && clientId !== parked.clientId) {
		await deletePendingPhotos(parked.clientId).catch(() => undefined);
	}
	return 'saved';
}

export function removeOfflineExpense(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const removed = currentExpenses.find(expense => expense.id === id);
	const updatedExpenses = currentExpenses.filter(expense => expense.id !== id);
	if (saveOfflineExpenses(updatedExpenses) && removed?.clientId) {
		deletePendingPhotos(removed.clientId).catch(() => undefined);
	}
}

function hasPhotoStore(): boolean {
	return browser && typeof indexedDB !== 'undefined';
}

function openPhotoDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(PHOTO_DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(PHOTO_STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function runPhotoStore<T>(
	mode: 'readonly' | 'readwrite',
	operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openPhotoDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction(PHOTO_STORE, mode);
			const request = operation(transaction.objectStore(PHOTO_STORE));
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

export async function savePendingPhotos(clientId: string, photos: File[]): Promise<boolean> {
	if (photos.length === 0) {
		if (hasPhotoStore()) await deletePendingPhotos(clientId).catch(() => undefined);
		return true;
	}
	if (!hasPhotoStore()) return false;
	try {
		await runPhotoStore('readwrite', store => store.put(photos, clientId));
		return true;
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline photos:', error);
		return false;
	}
}

export async function loadPendingPhotos(clientId: string): Promise<File[]> {
	if (!hasPhotoStore()) return [];
	const photos = await runPhotoStore<unknown>('readonly', store => store.get(clientId));
	return Array.isArray(photos) ? photos : [];
}

export async function deletePendingPhotos(clientId: string): Promise<void> {
	if (!hasPhotoStore()) return;
	await runPhotoStore('readwrite', store => store.delete(clientId));
}

export function getPendingExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && !expense.needsAttention);
}

export function getNeedsAttentionExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && expense.needsAttention);
}

export function markExpenseNeedsAttention(id: string, reason?: string, serverId?: string): void {
	const currentExpenses = loadOfflineExpenses();

	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id
			? {
					...expense,
					needsAttention: true,
					...(reason !== undefined && { attentionReason: reason }),
					...(serverId !== undefined && { serverId })
				}
			: expense
	);
	saveOfflineExpenses(updatedExpenses);
}

export function clearNeedsAttention(id: string): void {
	const currentExpenses = loadOfflineExpenses();

	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id
			? {
					...expense,
					needsAttention: false,
					attentionReason: undefined,
					lastError: undefined
				}
			: expense
	);

	saveOfflineExpenses(updatedExpenses);
}

export function noteSyncError(id: string, message: string): void {
	saveOfflineExpenses(
		loadOfflineExpenses().map(expense =>
			expense.id === id ? { ...expense, lastError: message } : expense
		)
	);
}

export function markExpenseAsSynced(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, synced: true } : expense
	);

	saveOfflineExpenses(updatedExpenses);
}

export function clearSyncedExpenses(): void {
	const currentExpenses = loadOfflineExpenses();
	const pendingExpenses = currentExpenses.filter(expense => !expense.synced);
	saveOfflineExpenses(pendingExpenses);
}
