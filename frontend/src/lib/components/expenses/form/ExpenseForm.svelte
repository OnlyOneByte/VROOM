<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { gotoDynamic, gotoWithQuery } from '$lib/utils/navigation';
	import { onlineStatus } from '$lib/stores/offline.svelte';
	import { addOfflineExpense } from '$lib/utils/offline-storage';
	import { classifySyncFailure, type SyncFailureKind } from '$lib/utils/sync/classify-failure';
	import { extractErrorMessage } from '$lib/utils/error-handling';
	import { appStore } from '$lib/stores/app.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { expenseApi } from '$lib/services/expense-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import {
		Save,
		ArrowLeft,
		Gauge,
		Check,
		X,
		Trash2,
		LoaderCircle,
		GitBranch,
		Shield,
		CreditCard,
		Copy
	} from '@lucide/svelte';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import CategorySelector from './CategorySelector.svelte';
	import FuelFieldsSection from './FuelFieldsSection.svelte';
	import TagInput from './TagInput.svelte';
	import ExpensePhotoSection from './ExpensePhotoSection.svelte';
	import PendingPhotoPreview from './PendingPhotoPreview.svelte';
	import ReceiptScanButton from './ReceiptScanButton.svelte';
	import type { ReceiptDraft } from '$lib/services/vlm-api';
	import SplitConfigEditor from '../split/SplitConfigEditor.svelte';
	import { validateExpenseField } from './expense-form-validation';
	import { toOfflineExpense } from './offline-expense';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import {
		formatCurrency,
		formatDate,
		dateOnlyToISO,
		toDateInputValue
	} from '$lib/utils/formatters';
	import {
		buildSplitConfig,
		categoryLabels,
		resetSplitAllocations
	} from '$lib/utils/expense-helpers';
	import { extractUniqueTags } from '$lib/utils/expense-filters';
	import { COMMON_EXPENSE_TAGS } from '$lib/types';
	import type { ExpenseCategory, ExpenseFormErrors, Vehicle, Expense } from '$lib/types';
	import { isElectricFuelType, getDistanceUnitLabel } from '$lib/utils/units';
	import FormLayout from '$lib/components/common/form-layout.svelte';

	interface Props {
		expenseId?: string;
		returnTo?: string;
		preselectedVehicleId?: string | null;
		preselectedCategory?: string | null;
		preselectedFinancingId?: string | null;
		preselectedAmount?: string | null;
		preselectedDescription?: string | null;
		preselectedTags?: string | null;
	}

	let {
		expenseId,
		returnTo = '/expenses',
		preselectedVehicleId = null,
		preselectedCategory = null,
		preselectedFinancingId = null,
		preselectedAmount = null,
		preselectedDescription = null,
		preselectedTags = null
	}: Props = $props();

	let isEditMode = $derived(!!expenseId);

	let formData = $state({
		vehicleId: '',
		tags: [] as string[],
		category: '',
		amount: '',
		date: toDateInputValue(new Date()),
		mileage: '',
		volume: '',
		charge: '',
		fuelType: '',
		description: '',
		location: '',
		missedFillup: false
	});

	// expenseId is fixed for this component's life and the load runs only in onMount; the state_referenced_locally warning here is intentional.
	let isLoading = $state(!!expenseId);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let vehicles = $state<Vehicle[]>([]);
	let errors = $state<ExpenseFormErrors>({});
	// Failures no single field owns (server rejection or storage failure); shown next to Save.
	let submitError = $state<string | null>(null);
	let touched = $state<Record<string, boolean>>({});
	let originalExpense = $state<Expense | null>(null);
	let vehicle = $state<Vehicle | null>(null);
	let lastFuelExpense = $state<Expense | null>(null);
	let allVehicleExpenses = $state<Expense[]>([]);
	let showMpgCalculation = $state(false);
	let calculatedMpg = $state<number | null>(null);
	let calculatedEfficiency = $state<number | null>(null);

	let isSplit = $state(false);
	let splitMethod = $state<'even' | 'absolute' | 'percentage'>('even');
	let splitAllocations = $state<Array<{ vehicleId: string; amount?: number; percentage?: number }>>(
		[]
	);
	let selectedVehicleIds = $state<string[]>([]);

	let isGroupEditMode = $state(false);
	let groupId = $state<string | null>(null);

	let showPerVehicleMileage = $state(false);
	let splitMileages = $state<Record<string, string>>({});

	let isInsuranceManaged = $state(false);
	let insurancePolicyId = $state<string | null>(null);

	let sourceType = $state<string | null>(null);
	let sourceId = $state<string | null>(null);

	let pendingFiles = $state<File[]>([]);

	let parsedTotalAmount = $derived(parseFloat(formData.amount) || 0);

	// Common tags first, then the user's previously-used tags not already in the common list.
	let tagSuggestions = $derived.by(() => {
		const historical = extractUniqueTags(allVehicleExpenses);
		const commonSet = new Set<string>(COMMON_EXPENSE_TAGS);
		return [...COMMON_EXPENSE_TAGS, ...historical.filter(t => !commonSet.has(t))];
	});

	let settings = $derived(settingsStore.settings);
	let volumeUnit = $derived(settings?.unitPreferences?.volumeUnit || 'gallons_us');
	let chargeUnit = $derived(settings?.unitPreferences?.chargeUnit || 'kwh');
	let distanceUnit = $derived(settings?.unitPreferences?.distanceUnit || 'miles');
	let currencyUnit = $derived(settings?.currencyUnit || 'USD');

	let effectiveDistanceUnit = $derived(vehicle?.unitPreferences?.distanceUnit ?? distanceUnit);
	let distLabel = $derived(getDistanceUnitLabel(effectiveDistanceUnit, false));

	onMount(async () => {
		await settingsStore.load();
		await loadVehicles();

		if (isEditMode && expenseId) {
			await loadExpense();
		} else {
			if (preselectedVehicleId) {
				formData.vehicleId = preselectedVehicleId;
			}
			if (preselectedCategory) {
				formData.category = preselectedCategory;
			}
			if (preselectedAmount) {
				formData.amount = preselectedAmount;
			}
			if (preselectedDescription) {
				formData.description = preselectedDescription;
			}
			if (preselectedTags) {
				// Duplicate tags arrive comma-separated; trim, drop blanks, and apply the 10-tag cap.
				formData.tags = preselectedTags
					.split(',')
					.map(t => t.trim())
					.filter(Boolean)
					.slice(0, 10);
			}
			// Date stays today: a duplicate is a new occurrence of a recurring expense, not a copy.
		}

		if (formData.vehicleId) {
			await loadVehicle();
			await loadLastFuelExpense();
			await loadAllVehicleExpenses();
		}

		// Set after the vehicle load so the vehicle-change $effect does not reset them.
		if (!isEditMode && preselectedFinancingId) {
			sourceType = 'financing';
			sourceId = preselectedFinancingId;
		}
	});

	async function loadVehicles() {
		try {
			vehicles = await vehicleApi.getVehicles();
			if (!isEditMode && vehicles.length > 0 && !formData.vehicleId) {
				const firstVehicle = vehicles[0];
				if (firstVehicle) formData.vehicleId = firstVehicle.id;
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load vehicles:', error);
		}
	}

	async function loadExpense() {
		try {
			const expense = await expenseApi.getExpense(expenseId!);
			if (!expense) {
				appStore.addNotification({ type: 'error', message: 'Expense not found' });
				gotoDynamic(returnTo);
				return;
			}

			originalExpense = expense;

			if (expense.groupId) {
				groupId = expense.groupId;
				try {
					const splitGroup = await expenseApi.getSplitExpense(expense.groupId);
					const first = splitGroup.siblings[0];
					if (!first) throw new Error('Empty split group');

					const isInsurance = first.tags?.includes('insurance') ?? false;
					if (isInsurance) {
						isInsuranceManaged = true;
						formData.category = first.category;
						formData.amount = splitGroup.groupTotal.toString();
						formData.tags = first.tags || [];
						formData.date = toDateInputValue(first.date);
						formData.description = first.description || '';
						isLoading = false;
						return;
					}

					isGroupEditMode = true;
					formData.category = first.category;
					formData.amount = splitGroup.groupTotal.toString();
					formData.tags = first.tags || [];
					formData.date = toDateInputValue(first.date);
					formData.description = first.description || '';

					isSplit = true;
					const method = (splitGroup.splitMethod as 'even' | 'absolute' | 'percentage') || 'even';
					splitMethod = method;
					selectedVehicleIds = splitGroup.siblings.map(s => s.vehicleId);
					if (method === 'even') {
						splitAllocations = splitGroup.siblings.map(s => ({ vehicleId: s.vehicleId }));
					} else if (method === 'absolute') {
						splitAllocations = splitGroup.siblings.map(s => ({
							vehicleId: s.vehicleId,
							amount: s.amount
						}));
					} else {
						splitAllocations = splitGroup.siblings.map(s => ({
							vehicleId: s.vehicleId,
							percentage:
								splitGroup.groupTotal > 0
									? Math.round((s.amount / splitGroup.groupTotal) * 1000) / 10
									: 0
						}));
					}
				} catch (err) {
					if (import.meta.env.DEV) console.error('Failed to load split group:', err);
					appStore.addNotification({
						type: 'error',
						message: 'Failed to load split expense group'
					});
					gotoDynamic(returnTo);
					return;
				}
				isLoading = false;
				return;
			}

			formData.vehicleId = expense.vehicleId;
			formData.tags = expense.tags || [];
			formData.category = expense.category;
			formData.amount = expense.amount.toString();
			formData.date = toDateInputValue(expense.date);
			formData.mileage = expense.mileage?.toString() ?? '';
			formData.volume = expense.volume?.toString() ?? '';
			formData.charge = expense.charge?.toString() ?? '';
			formData.fuelType = expense.fuelType || '';
			formData.description = expense.description || '';
			formData.location = expense.location || '';
			formData.missedFillup = expense.missedFillup ?? false;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading expense:', error);
			appStore.addNotification({ type: 'error', message: 'Error loading expense' });
			gotoDynamic(returnTo);
		} finally {
			isLoading = false;
		}
	}

	async function loadVehicle() {
		try {
			vehicle = await vehicleApi.getVehicle(formData.vehicleId);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading vehicle:', error);
		}
	}

	async function loadLastFuelExpense() {
		try {
			const result = await expenseApi.getExpensesByVehicle(formData.vehicleId, {
				limit: 2,
				category: 'fuel'
			});
			const fuelExpenses = result.data.filter((e: { id: string }) => e.id !== expenseId);
			lastFuelExpense = fuelExpenses[0] ?? null;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading last fuel expense:', error);
		}
	}

	async function loadAllVehicleExpenses() {
		try {
			const result = await expenseApi.getExpensesByVehicle(formData.vehicleId, { limit: 100 });
			allVehicleExpenses = result.data;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error loading vehicle expenses:', error);
		}
	}

	/** Applies a VLM receipt draft: only fields the draft carries are set; category goes through selectCategory so its side effects fire. */
	function handleReceiptDraft(draft: ReceiptDraft, image: File) {
		if (typeof draft.amount === 'number') formData.amount = String(draft.amount);
		if (draft.date) formData.date = draft.date;
		if (typeof draft.odometer === 'number') formData.mileage = String(draft.odometer);
		if (draft.category) selectCategory(draft.category);
		// Only fill an EMPTY description — never clobber something the user already typed.
		if (draft.vendor && !formData.description.trim()) formData.description = draft.vendor;
		pendingFiles = [...pendingFiles, image];
		appStore.showSuccess('Receipt scanned — review the details and save.');
	}

	function selectCategory(categoryValue: string) {
		formData.category = categoryValue;
		touched['category'] = true;
		handleBlur('category');

		if (categoryValue !== 'financial') {
			sourceType = null;
			sourceId = null;
		}

		// Clear fuel-only fields when leaving fuel; hidden inputs would otherwise persist and submit stale values.
		if (categoryValue !== 'fuel') {
			formData.volume = '';
			formData.charge = '';
			formData.fuelType = '';
			formData.mileage = '';
			formData.missedFillup = false;
		}
	}

	let previousVehicleId = $state('');
	$effect(() => {
		if (formData.vehicleId && formData.vehicleId !== previousVehicleId) {
			previousVehicleId = formData.vehicleId;
			if (vehicle !== null || !isLoading) {
				// Skipped during the edit-mode load, where loadExpense sets the correct value.
				if (!isEditMode || vehicle !== null) {
					sourceType = null;
					sourceId = null;
				}
				loadVehicle();
				loadLastFuelExpense();
				loadAllVehicleExpenses();
			}
		}
	});

	let showFuelFields = $derived(formData.category === 'fuel');

	let isFinancingPayment = $derived(sourceType === 'financing' && !!sourceId);

	let showVolumeField = $derived(showFuelFields && !isElectricFuelType(formData.fuelType));
	let showChargeField = $derived(showFuelFields && isElectricFuelType(formData.fuelType));

	function handleMileageChange() {
		if (formData.category === 'fuel' && formData.mileage && lastFuelExpense?.mileage) {
			const milesDriven = parseInt(formData.mileage) - lastFuelExpense.mileage;

			if (milesDriven > 0) {
				if (isElectricFuelType(formData.fuelType) && formData.charge) {
					calculatedEfficiency =
						Math.round((milesDriven / parseFloat(formData.charge)) * 100) / 100;
					calculatedMpg = null;
					showMpgCalculation = true;
				} else if (!isElectricFuelType(formData.fuelType) && formData.volume) {
					calculatedMpg = Math.round((milesDriven / parseFloat(formData.volume)) * 100) / 100;
					calculatedEfficiency = null;
					showMpgCalculation = true;
				} else {
					calculatedMpg = null;
					calculatedEfficiency = null;
					showMpgCalculation = false;
				}
			} else {
				calculatedMpg = null;
				calculatedEfficiency = null;
				showMpgCalculation = false;
			}
		}
	}

	function handleBlur(field: string) {
		touched[field] = true;
		const error = validateExpenseField(field, {
			category: formData.category,
			vehicle,
			volumeUnit,
			chargeUnit,
			allVehicleExpenses,
			expenseId,
			formData: formData as unknown as Record<string, string | string[]>
		});
		if (error) {
			errors[field] = error;
		} else {
			delete errors[field];
			errors = { ...errors };
		}

		if (field === 'date' && formData.mileage) {
			handleBlur('mileage');
		}
	}

	function validateForm(): boolean {
		errors = {};
		const fields: string[] = isGroupEditMode
			? ['category', 'amount', 'date']
			: ['vehicleId', 'category', 'amount', 'date'];
		if (showFuelFields) {
			fields.push('mileage');
			if (showVolumeField) fields.push('volume');
			if (showChargeField) fields.push('charge');
		}

		const ctx = {
			category: formData.category,
			vehicle,
			volumeUnit,
			chargeUnit,
			allVehicleExpenses,
			expenseId,
			formData: formData as unknown as Record<string, string | string[]>
		};

		for (const field of fields) {
			const error = validateExpenseField(field, ctx);
			if (error) errors[field] = error;
		}

		return Object.keys(errors).length === 0;
	}

	/** Message for a submit that could not be queued offline; the user stays on the form with their data. */
	function submitFailureMessage(kind: SyncFailureKind, error: unknown): string {
		if (kind === 'auth') return 'Your session has expired. Please sign in again.';
		if (kind === 'transient') return 'Network error. Please try again.';
		// The server's reason is the only message that tells the user what to change.
		return extractErrorMessage(error, 'Could not save this expense. Please try again.');
	}

	/** Message for when the offline outbox write itself fails; the user stays on the form so nothing is lost. */
	function reportUnqueuedSave(): void {
		submitError =
			'This device could not store the expense — storage is full or site data is blocked. ' +
			'Your entry is still on this form: try again, or copy the values before leaving the page.';
		appStore.addNotification({ type: 'error', message: submitError });
	}

	async function handleSubmit() {
		if (!validateForm()) {
			Object.keys(formData).forEach(field => {
				touched[field] = true;
			});
			return;
		}

		isSubmitting = true;
		submitError = null;

		// Built outside try so the offline fallback queues exactly what the server would have received.
		const dateISO = dateOnlyToISO(formData.date);
		const expenseData = {
			vehicleId: formData.vehicleId,
			tags: formData.tags,
			category: formData.category as ExpenseCategory,
			amount: parseFloat(formData.amount),
			date: dateISO,
			mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
			volume: formData.volume ? parseFloat(formData.volume) : undefined,
			charge: formData.charge ? parseFloat(formData.charge) : undefined,
			fuelType: formData.fuelType || undefined,
			description: formData.description || undefined,
			location: formData.location || undefined,
			currency: currencyUnit,
			sourceType: sourceType ?? undefined,
			sourceId: sourceId ?? undefined,
			missedFillup: formData.missedFillup
		};

		try {
			if (isGroupEditMode && groupId) {
				const splitConfig = buildSplitConfig(splitMethod, selectedVehicleIds, splitAllocations);
				await expenseApi.updateSplitExpense(groupId, {
					splitConfig,
					totalAmount: parseFloat(formData.amount)
				});

				appStore.addNotification({
					type: 'success',
					message: 'Split expense updated successfully'
				});
				gotoDynamic(returnTo);
			} else if (isEditMode) {
				await expenseApi.updateExpense(expenseId!, expenseData);

				appStore.addNotification({
					type: 'success',
					message: 'Expense updated successfully'
				});
				gotoDynamic(returnTo);
			} else if (isSplit && selectedVehicleIds.length >= 2) {
				const splitConfig = buildSplitConfig(splitMethod, selectedVehicleIds, splitAllocations);
				const result = await expenseApi.createSplitExpense({
					splitConfig,
					category: formData.category as ExpenseCategory,
					tags: formData.tags.length > 0 ? formData.tags : undefined,
					date: dateISO,
					description: formData.description || undefined,
					totalAmount: parseFloat(formData.amount)
				});

				const firstSibling = result.siblings[0];
				if (firstSibling) {
					await uploadPendingPhotos(firstSibling.id);
				}

				appStore.addNotification({
					type: 'success',
					message: 'Split expense created successfully'
				});
				gotoDynamic(returnTo);
			} else {
				if (onlineStatus.current) {
					const created = await expenseApi.createExpense(expenseData);

					await uploadPendingPhotos(created.id);

					appStore.addNotification({
						type: 'success',
						message: 'Expense added successfully'
					});
					gotoDynamic(returnTo);
				} else {
					const queued = addOfflineExpense(toOfflineExpense(expenseData));

					if (!queued) {
						reportUnqueuedSave();
						return;
					}

					appStore.addNotification({
						type: 'info',
						message: 'Expense saved offline. Will sync when online.'
					});

					gotoDynamic(returnTo);
				}
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to save expense:', error);

			// Server-decided failures stay on screen; only failures that can succeed later may be queued.
			// The outbox holds single expenses only, so a split create is never queued: it would land as
			// one full-total expense on the first vehicle.
			const failureKind = classifySyncFailure(error);
			const isSplitCreate = isSplit && selectedVehicleIds.length >= 2;

			if (!isEditMode && !isSplitCreate && failureKind !== 'terminal') {
				const queued = addOfflineExpense(toOfflineExpense(expenseData));

				if (!queued) {
					reportUnqueuedSave();
					return;
				}

				appStore.addNotification({
					type: 'warning',
					message:
						failureKind === 'auth'
							? 'Signed out — saved on this device. Sign in to sync it.'
							: 'Saved offline due to connection issue. Will sync when online.'
				});

				gotoDynamic(returnTo);
			} else {
				submitError = submitFailureMessage(failureKind, error);
				appStore.addNotification({ type: 'error', message: submitError });
			}
		} finally {
			isSubmitting = false;
		}
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function handleDelete() {
		if (!expenseId) return;

		isDeleting = true;

		try {
			// Split members share a groupId; deleting only expenseId would orphan the other vehicles' portions.
			if (groupId) {
				await expenseApi.deleteSplitExpense(groupId);
			} else {
				await expenseApi.deleteExpense(expenseId);
			}

			appStore.addNotification({
				type: 'success',
				message: 'Expense deleted successfully'
			});
			gotoDynamic(returnTo);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to delete expense:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Failed to delete expense. Please try again.'
			});
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleBack() {
		gotoDynamic(returnTo);
	}

	// Split and insurance-managed expenses belong to other flows, so they cannot be duplicated as a single expense.
	let canDuplicate = $derived(isEditMode && !isGroupEditMode && !isInsuranceManaged);

	// Date is omitted on purpose: a duplicate is the next occurrence of a recurring expense.
	function handleDuplicate() {
		const query: Record<string, string> = { returnTo };
		if (formData.vehicleId) query['vehicleId'] = formData.vehicleId;
		if (formData.category) query['category'] = formData.category;
		if (formData.amount) query['amount'] = formData.amount;
		if (formData.description) query['description'] = formData.description;
		if (formData.tags.length > 0) query['tags'] = formData.tags.join(',');
		gotoWithQuery(resolve(routes.expenseNew), query);
	}

	async function uploadPendingPhotos(entityId: string): Promise<void> {
		if (pendingFiles.length === 0) return;
		let failCount = 0;
		for (const file of pendingFiles) {
			try {
				await expenseApi.uploadPhoto('expense', entityId, file);
			} catch {
				failCount++;
			}
		}
		if (failCount > 0) {
			appStore.addNotification({
				type: 'warning',
				message: `${failCount} photo${failCount > 1 ? 's' : ''} failed to upload. You can re-upload in edit mode.`
			});
		}
		pendingFiles = [];
	}

	function handleSplitToggle(checked: boolean) {
		isSplit = checked;
		if (checked) {
			if (formData.vehicleId) {
				selectedVehicleIds = [formData.vehicleId];
			}
			splitMethod = 'even';
			splitAllocations = [];
		} else {
			if (selectedVehicleIds.length > 0) {
				const firstId = selectedVehicleIds[0];
				if (firstId) formData.vehicleId = firstId;
			}
			selectedVehicleIds = [];
			splitMethod = 'even';
			splitAllocations = [];
		}
	}

	function handleMethodChange(method: 'even' | 'absolute' | 'percentage') {
		splitMethod = method;
		splitAllocations = resetSplitAllocations(method, selectedVehicleIds);
	}

	function handleAllocationsChange(
		allocs: Array<{ vehicleId: string; amount?: number; percentage?: number }>
	) {
		splitAllocations = allocs;
	}
</script>

<FormLayout>
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if isInsuranceManaged}
		<div class="space-y-6">
			<div class="flex items-center gap-4">
				<button
					aria-label="Go back"
					onclick={() => gotoDynamic(returnTo)}
					class="p-2 hover:bg-muted rounded-lg"
				>
					<ArrowLeft class="h-5 w-5" />
				</button>
				<div>
					<h1 class="text-2xl font-bold text-foreground">Insurance Expense</h1>
					<p class="text-muted-foreground">This expense is managed by an insurance policy</p>
				</div>
			</div>

			<div class="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
				<Shield class="mt-0.5 h-5 w-5 shrink-0 text-chart-3" />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-foreground">Managed by insurance policy</p>
					<p class="mt-1 text-xs text-muted-foreground">
						This expense was automatically created from an insurance term. To change the amount or
						split, edit the insurance policy term.
					</p>
					{#if insurancePolicyId}
						<Button
							variant="outline"
							size="sm"
							class="mt-3"
							onclick={() => {
								const queryObj: Record<string, string> = {};
								if (insurancePolicyId) queryObj['policy'] = insurancePolicyId;
								if (sourceType === 'insurance_term' && sourceId) queryObj['editTerm'] = sourceId;
								gotoWithQuery(resolve(routes.insurance), queryObj);
							}}
						>
							<Shield class="mr-2 h-4 w-4" />
							Edit Insurance Term
						</Button>
					{/if}
				</div>
			</div>

			<div class="rounded-lg border bg-card p-6 space-y-4">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<p class="text-muted-foreground">Category</p>
						<p class="font-medium text-foreground">
							{categoryLabels[formData.category as keyof typeof categoryLabels] ??
								formData.category}
						</p>
					</div>
					<div>
						<p class="text-muted-foreground">Total Amount</p>
						<p class="font-medium text-foreground">
							{formatCurrency(parseFloat(formData.amount) || 0)}
						</p>
					</div>
					<div>
						<p class="text-muted-foreground">Date</p>
						<!-- Date-only values go through dateOnlyToISO, which also avoids throwing on an empty picker. -->
						<p class="font-medium text-foreground">
							{formatDate(dateOnlyToISO(formData.date))}
						</p>
					</div>
					{#if formData.description}
						<div>
							<p class="text-muted-foreground">Description</p>
							<p class="font-medium text-foreground">{formData.description}</p>
						</div>
					{/if}
				</div>
				{#if formData.tags.length > 0}
					<div>
						<p class="text-sm text-muted-foreground">Tags</p>
						<div class="mt-1 flex flex-wrap gap-1">
							{#each formData.tags as tag (tag)}
								<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			{#if groupId && originalExpense}
				<div class="rounded-lg border bg-card p-6">
					<ExpensePhotoSection entityType="expense" entityId={originalExpense.id} />
				</div>
			{/if}

			<div class="flex justify-center gap-3">
				<Button variant="outline" onclick={() => gotoDynamic(returnTo)}>
					<ArrowLeft class="mr-2 h-4 w-4" />
					Back to Expenses
				</Button>
				<Button
					variant="destructive"
					onclick={() => (showDeleteConfirm = true)}
					disabled={isDeleting}
				>
					<Trash2 class="mr-2 h-4 w-4" />
					Force Delete
				</Button>
			</div>
		</div>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<div class="flex items-center gap-4">
				<button
					aria-label="Go back"
					onclick={() => gotoDynamic(returnTo)}
					class="p-2 hover:bg-muted rounded-lg"
				>
					<ArrowLeft class="h-5 w-5" />
				</button>

				<div>
					<h1 class="text-2xl font-bold text-foreground">
						{isGroupEditMode ? 'Edit Split Expense' : isEditMode ? 'Edit Expense' : 'Add Expense'}
					</h1>
					<p class="text-muted-foreground">
						{#if isGroupEditMode && selectedVehicleIds.length > 0}
							{selectedVehicleIds
								.map(id => {
									const v = vehicles.find(veh => veh.id === id);
									return v ? getVehicleDisplayName(v) : '';
								})
								.filter(Boolean)
								.join(', ')}
						{:else if isEditMode}
							{getVehicleDisplayName(vehicle)}
						{:else if !onlineStatus.current}
							<span class="text-chart-5">Offline mode - will sync when online</span>
						{:else}
							Track a new vehicle expense
						{/if}
					</p>
				</div>
			</div>

			<form
				onsubmit={e => {
					e.preventDefault();
					handleSubmit();
				}}
				class="rounded-lg border bg-card p-6 space-y-6"
			>
				{#if !isEditMode && !isSplit && !isInsuranceManaged}
					<ReceiptScanButton onDraft={handleReceiptDraft} />
				{/if}

				{#if isSplit}
					<div class="space-y-2">
						<Label>Vehicles *</Label>
						<div class="rounded-md border border-input p-3 space-y-2">
							{#each vehicles as v (v.id)}
								<label class="flex items-center gap-2 cursor-pointer">
									<Checkbox
										checked={selectedVehicleIds.includes(v.id)}
										onCheckedChange={() => {
											if (selectedVehicleIds.includes(v.id)) {
												selectedVehicleIds = selectedVehicleIds.filter(id => id !== v.id);
											} else {
												selectedVehicleIds = [...selectedVehicleIds, v.id];
											}
											splitAllocations = resetSplitAllocations(splitMethod, selectedVehicleIds);
										}}
									/>
									<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
								</label>
							{/each}
						</div>
						{#if !isEditMode}
							<button
								type="button"
								onclick={() => handleSplitToggle(false)}
								class="text-xs text-muted-foreground underline hover:text-foreground"
							>
								Remove split
							</button>
						{/if}
					</div>
				{:else}
					<div class="space-y-2">
						<Label for="vehicle">Vehicle *</Label>
						<div class="flex gap-2">
							<Select.Root
								type="single"
								value={formData.vehicleId}
								onValueChange={v => {
									if (v) {
										formData.vehicleId = v;
										touched['vehicleId'] = true;
										handleBlur('vehicleId');
									}
								}}
							>
								<Select.Trigger
									id="vehicle"
									class="w-full {touched['vehicleId'] && errors['vehicleId']
										? 'border-destructive'
										: ''}"
									aria-invalid={!!(touched['vehicleId'] && errors['vehicleId'])}
									aria-describedby={touched['vehicleId'] && errors['vehicleId']
										? 'vehicleId-error'
										: undefined}
								>
									{#if formData.vehicleId}
										{@const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId)}
										{#if selectedVehicle}
											{selectedVehicle.year}
											{selectedVehicle.make}
											{selectedVehicle.model}
											{#if selectedVehicle.nickname}({selectedVehicle.nickname}){/if}
										{:else}
											Select a vehicle
										{/if}
									{:else}
										Select a vehicle
									{/if}
								</Select.Trigger>
								<Select.Content>
									{#each vehicles as v (v.id)}
										<Select.Item value={v.id} label="{v.year} {v.make} {v.model}">
											{v.year}
											{v.make}
											{v.model}
											{#if v.nickname}({v.nickname}){/if}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if (!isEditMode || isGroupEditMode) && vehicles.length >= 2}
								<Button
									type="button"
									variant="outline"
									size="icon"
									class="shrink-0"
									onclick={() => handleSplitToggle(true)}
									aria-label="Split cost across vehicles"
								>
									<GitBranch class="h-4 w-4" />
								</Button>
							{/if}
						</div>
						{#if touched['vehicleId'] && errors['vehicleId']}
							<FormFieldError id="vehicleId-error">{errors['vehicleId']}</FormFieldError>
						{/if}
					</div>
				{/if}

				<CategorySelector
					value={formData.category}
					error={errors['category']}
					touched={touched['category']}
					onSelect={selectCategory}
				/>

				{#if isFinancingPayment}
					<div class="flex items-center gap-3 rounded-lg border bg-muted/50 p-4">
						<CreditCard class="h-4 w-4 text-chart-3" />
						<span class="text-sm font-medium leading-none text-foreground">
							Financing payment
						</span>
					</div>
				{/if}

				<div class="space-y-2">
					<Label for="date">Date *</Label>
					<DatePicker
						id="date"
						bind:value={formData.date}
						placeholder="Select date"
						aria-invalid={!!(touched['date'] && errors['date'])}
						aria-describedby={touched['date'] && errors['date'] ? 'date-error' : undefined}
					/>
					{#if touched['date'] && errors['date']}
						<FormFieldError id="date-error">{errors['date']}</FormFieldError>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="amount">Amount *</Label>
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<span class="text-muted-foreground">$</span>
						</div>
						<Input
							id="amount"
							type="number"
							step="0.01"
							min="0"
							bind:value={formData.amount}
							placeholder="0.00"
							class="pl-8"
							onblur={() => handleBlur('amount')}
							aria-invalid={!!(touched['amount'] && errors['amount'])}
							aria-describedby={touched['amount'] && errors['amount'] ? 'amount-error' : undefined}
						/>
					</div>
					{#if touched['amount'] && errors['amount']}
						<FormFieldError id="amount-error">{errors['amount']}</FormFieldError>
					{/if}
				</div>

				{#if isSplit && selectedVehicleIds.length >= 2 && parsedTotalAmount > 0}
					<div class="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
						<div class="flex items-center gap-2">
							<GitBranch class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm font-medium text-foreground">Split Breakdown</span>
						</div>
						<SplitConfigEditor
							vehicles={vehicles.filter(v => selectedVehicleIds.includes(v.id))}
							totalAmount={parsedTotalAmount}
							{splitMethod}
							allocations={splitAllocations}
							onMethodChange={handleMethodChange}
							onAllocationsChange={handleAllocationsChange}
						/>
					</div>
				{/if}

				{#if isSplit && selectedVehicleIds.length >= 2}
					<div class="space-y-2">
						<button
							type="button"
							onclick={() => (showPerVehicleMileage = !showPerVehicleMileage)}
							class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
						>
							<span class="text-xs">{showPerVehicleMileage ? '▾' : '▸'}</span>
							Add mileage readings (optional)
						</button>
						{#if showPerVehicleMileage}
							<div class="rounded-md border border-input p-3 space-y-3">
								{#each selectedVehicleIds as vid (vid)}
									{@const v = vehicles.find(veh => veh.id === vid)}
									{#if v}
										<div class="space-y-1">
											<Label for="mileage-{vid}" class="text-xs">{getVehicleDisplayName(v)}</Label>
											<div class="relative">
												<div
													class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
												>
													<Gauge class="h-4 w-4 text-muted-foreground" />
												</div>
												<Input
													id="mileage-{vid}"
													type="number"
													min="0"
													value={splitMileages[vid] ?? ''}
													oninput={e => {
														const target = e.currentTarget;
														if (target instanceof HTMLInputElement) {
															splitMileages[vid] = target.value;
														}
													}}
													placeholder="Current mileage"
													class="pl-10 h-9 text-sm"
												/>
											</div>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<div class="space-y-2">
						<Label for="mileage">
							Current Mileage {showFuelFields ? '*' : '(Optional)'}
						</Label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
								<Gauge class="h-5 w-5 text-muted-foreground" />
							</div>
							<Input
								id="mileage"
								type="number"
								min="0"
								bind:value={formData.mileage}
								placeholder="123456"
								class="pl-10"
								oninput={handleMileageChange}
								onblur={() => handleBlur('mileage')}
								aria-invalid={!!(touched['mileage'] && errors['mileage'])}
								aria-describedby={touched['mileage'] && errors['mileage']
									? 'mileage-error'
									: undefined}
							/>
						</div>
						{#if lastFuelExpense?.mileage && formData.tags.includes('fuel')}
							<p class="text-xs text-muted-foreground">
								Previous fuel entry: {lastFuelExpense.mileage.toLocaleString()}
								{distLabel.toLowerCase()}
							</p>
						{/if}
						{#if touched['mileage'] && errors['mileage']}
							<FormFieldError id="mileage-error">{errors['mileage']}</FormFieldError>
						{/if}
					</div>
				{/if}

				{#if showFuelFields && vehicle}
					<FuelFieldsSection
						trackFuel={vehicle.trackFuel}
						trackCharging={vehicle.trackCharging}
						bind:volume={formData.volume}
						bind:charge={formData.charge}
						bind:fuelType={formData.fuelType}
						bind:missedFillup={formData.missedFillup}
						amount={formData.amount}
						{volumeUnit}
						{chargeUnit}
						{distanceUnit}
						{calculatedMpg}
						{calculatedEfficiency}
						showMpgCalculation={showMpgCalculation && !formData.missedFillup}
						{errors}
						{touched}
						onBlur={handleBlur}
						onMileageChange={handleMileageChange}
					/>
				{/if}

				<div class="space-y-2">
					<Label for="description">Description (Optional)</Label>
					<Textarea
						id="description"
						bind:value={formData.description}
						rows={3}
						placeholder="Add any additional notes..."
						class="bg-background"
					/>
				</div>

				<!-- Location: a single-line free-text label, deliberately not GPS coordinates -->
				<div class="space-y-2">
					<Label for="location">Location (Optional)</Label>
					<Input
						id="location"
						bind:value={formData.location}
						placeholder="e.g. Shell, Main St"
						class="bg-background"
					/>
				</div>

				<TagInput
					bind:tags={formData.tags}
					error={errors['tags']}
					touched={touched['tags']}
					suggestions={tagSuggestions}
				/>

				{#if isGroupEditMode && groupId && originalExpense}
					<ExpensePhotoSection entityType="expense" entityId={originalExpense.id} />
				{:else if isEditMode && expenseId}
					<ExpensePhotoSection entityType="expense" entityId={expenseId} />
				{:else}
					<PendingPhotoPreview
						files={pendingFiles}
						onAdd={file => (pendingFiles = [...pendingFiles, file])}
						onRemove={i => (pendingFiles = pendingFiles.filter((_, idx) => idx !== i))}
					/>
				{/if}

				{#if submitError}
					<FormFieldError data-testid="submit-error" class="rounded-md bg-destructive/10 p-3">
						{submitError}
					</FormFieldError>
				{/if}
			</form>

			<div
				class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto z-50"
			>
				<div
					class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none"
				>
					{#if isEditMode}
						<Button
							type="button"
							variant="destructive"
							onclick={confirmDelete}
							disabled={isDeleting || isSubmitting}
							class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 border-0 flex-shrink-0"
						>
							<Trash2 class="h-5 w-5 sm:mr-2" />
							<!-- Clip rather than hide below sm: a sr-only rule would otherwise outrank sm:not-sr-only. -->
							<span class="max-sm:sr-only font-semibold">Delete</span>
						</Button>
					{/if}

					{#if canDuplicate}
						<Button
							type="button"
							variant="outline"
							onclick={handleDuplicate}
							disabled={isSubmitting || isDeleting}
							class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 flex-shrink-0"
						>
							<Copy class="h-5 w-5 sm:mr-2" />
							<span class="max-sm:sr-only font-semibold">Duplicate</span>
						</Button>
					{/if}

					<Button
						type="button"
						variant="outline"
						onclick={handleBack}
						disabled={isSubmitting || isDeleting}
						class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 flex-shrink-0"
					>
						<X class="h-5 w-5 sm:mr-2" />
						<span class="max-sm:sr-only font-semibold">Cancel</span>
					</Button>

					<Button
						type="button"
						onclick={handleSubmit}
						disabled={isSubmitting || isDeleting}
						class="sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 sm:h-14 px-6 border-0 flex-1 sm:flex-initial"
					>
						{#if isSubmitting}
							<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
							<span class="font-bold">{isEditMode ? 'Updating' : 'Saving'}...</span>
						{:else}
							<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
							<span class="font-bold">{isEditMode ? 'Update' : 'Save'} Expense</span>
						{/if}
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<AlertDialog.Root bind:open={showDeleteConfirm}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete Expense</AlertDialog.Title>
				<AlertDialog.Description>
					{#if isInsuranceManaged && groupId}
						This will delete the insurance expense group and all its child expenses. This action
						cannot be undone.
					{:else if isGroupEditMode && groupId}
						This is a split expense shared across multiple vehicles. Deleting it removes the entire
						split — every vehicle's portion — not just one. This action cannot be undone.
					{:else}
						Are you sure you want to delete this expense? This action cannot be undone.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>

			{#if originalExpense}
				<div class="bg-muted rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-destructive/10 text-destructive">
							<Save class="h-4 w-4" />
						</div>
						<div>
							<p class="font-medium text-foreground">
								{originalExpense.description || originalExpense.tags?.join(', ') || 'Expense'}
							</p>
							<p class="text-sm text-muted-foreground">
								{formatCurrency(originalExpense.amount)} on {new Date(
									originalExpense.date
								).toLocaleDateString()}
							</p>
						</div>
					</div>
				</div>
			{/if}

			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={isDeleting}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={handleDelete}
					disabled={isDeleting}
					class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
				>
					{#if isDeleting}
						<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
						Deleting...
					{:else}
						Delete Expense
					{/if}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</FormLayout>
