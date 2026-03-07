<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { gotoDynamic, gotoWithQuery } from '$lib/utils/navigation';
	import { onlineStatus } from '$lib/stores/offline.svelte';
	import { addOfflineExpense } from '$lib/utils/offline-storage';
	import { requestBackgroundSync } from '$lib/utils/pwa';
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
		Shield
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
	import SplitCostSheet from './SplitCostSheet.svelte';
	import { validateExpenseField } from './expense-form-validation';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { formatCurrency } from '$lib/utils/formatters';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import type {
		ExpenseCategory,
		ExpenseFormErrors,
		Vehicle,
		Expense,
		SplitConfig
	} from '$lib/types';
	import { isElectricFuelType, getDistanceUnitLabel } from '$lib/utils/units';
	import FormLayout from '$lib/components/common/form-layout.svelte';

	interface Props {
		expenseId?: string;
		returnTo?: string;
		preselectedVehicleId?: string | null;
		preselectedCategory?: string | null;
		preselectedIsFinancingPayment?: boolean;
		preselectedAmount?: string | null;
	}

	let {
		expenseId,
		returnTo = '/expenses',
		preselectedVehicleId = null,
		preselectedCategory = null,
		preselectedIsFinancingPayment = false,
		preselectedAmount = null
	}: Props = $props();

	// Determine if we're in edit mode
	let isEditMode = $derived(!!expenseId);

	// Form data
	let formData = $state({
		vehicleId: '',
		tags: [] as string[],
		category: '',
		amount: '',
		date: new Date().toISOString().split('T')[0],
		mileage: '',
		volume: '',
		charge: '',
		fuelType: '',
		description: '',
		isFinancingPayment: false,
		missedFillup: false
	});

	// Form state
	let isLoading = $state(!!expenseId);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let vehicles = $state<Vehicle[]>([]);
	let errors = $state<ExpenseFormErrors>({});
	let touched = $state<Record<string, boolean>>({});
	let originalExpense = $state<Expense | null>(null);
	let vehicle = $state<Vehicle | null>(null);
	let lastFuelExpense = $state<Expense | null>(null);
	let allVehicleExpenses = $state<Expense[]>([]);
	let showMpgCalculation = $state(false);
	let calculatedMpg = $state<number | null>(null);
	let calculatedEfficiency = $state<number | null>(null);

	// Split expense state (create mode only)
	let isSplit = $state(false);
	let splitMethod = $state<'even' | 'absolute' | 'percentage'>('even');
	let splitAllocations = $state<Array<{ vehicleId: string; amount?: number; percentage?: number }>>(
		[]
	);
	let selectedVehicleIds = $state<string[]>([]);

	// Group edit mode — when editing a child expense, we load the parent group
	let isGroupEditMode = $state(false);
	let groupId = $state<string | null>(null);
	let showSplitSheet = $state(false);

	// Insurance-managed mode — read-only, links to policy page
	let isInsuranceManaged = $state(false);
	let insurancePolicyId = $state<string | null>(null);
	let insuranceTermId = $state<string | null>(null);

	// Pending photo files for create mode (uploaded after expense is saved)
	let pendingFiles = $state<File[]>([]);

	let parsedTotalAmount = $derived(parseFloat(formData.amount) || 0);

	// Split summary for compact display
	let splitSummaryText = $derived.by(() => {
		if (!isSplit || selectedVehicleIds.length < 2) return '';
		const methodLabel =
			splitMethod === 'even' ? 'Even' : splitMethod === 'absolute' ? 'Fixed' : 'Percentage';
		return `${methodLabel} split across ${selectedVehicleIds.length} vehicles`;
	});

	// Get user settings for units
	let settings = $derived(settingsStore.settings);
	let volumeUnit = $derived(settings?.unitPreferences?.volumeUnit || 'gallons_us');
	let chargeUnit = $derived(settings?.unitPreferences?.chargeUnit || 'kwh');
	let distanceUnit = $derived(settings?.unitPreferences?.distanceUnit || 'miles');
	let currencyUnit = $derived(settings?.currencyUnit || 'USD');

	// Resolve distance label from vehicle unitPreferences, falling back to global settings
	let effectiveDistanceUnit = $derived(vehicle?.unitPreferences?.distanceUnit ?? distanceUnit);
	let distLabel = $derived(getDistanceUnitLabel(effectiveDistanceUnit, false));

	// Tag suggestions will be populated from user's previous tags in the future

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
		}

		if (formData.vehicleId) {
			await loadVehicle();
			await loadLastFuelExpense();
			await loadAllVehicleExpenses();
		}

		// Set financing payment flag AFTER vehicle is loaded so the $effect
		// for vehicle changes has already fired and won't reset it
		if (!isEditMode && preselectedIsFinancingPayment) {
			formData.isFinancingPayment = true;
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

			// Switch to group edit mode if this is a child of a split group
			if (expense.expenseGroupId) {
				groupId = expense.expenseGroupId;
				try {
					const groupData = await expenseApi.getSplitExpense(expense.expenseGroupId);
					const group = groupData.group;

					// Check if this is insurance-managed
					if (group.insurancePolicyId) {
						isInsuranceManaged = true;
						insurancePolicyId = group.insurancePolicyId;
						insuranceTermId = group.insuranceTermId ?? null;
						// Still populate form data for read-only display
						formData.category = group.category;
						formData.amount = group.totalAmount.toString();
						formData.tags = group.tags || [];
						const groupDate = new Date(group.date);
						formData.date = `${groupDate.getFullYear()}-${String(groupDate.getMonth() + 1).padStart(2, '0')}-${String(groupDate.getDate()).padStart(2, '0')}`;
						formData.description = group.description || '';
						isLoading = false;
						return;
					}

					// User-created split — enter group edit mode
					isGroupEditMode = true;
					formData.category = group.category;
					formData.amount = group.totalAmount.toString();
					formData.tags = group.tags || [];
					const groupDate = new Date(group.date);
					formData.date = `${groupDate.getFullYear()}-${String(groupDate.getMonth() + 1).padStart(2, '0')}-${String(groupDate.getDate()).padStart(2, '0')}`;
					formData.description = group.description || '';

					// Set up split state from group config
					isSplit = true;
					splitMethod = group.splitConfig.method;
					if (group.splitConfig.method === 'even') {
						selectedVehicleIds = group.splitConfig.vehicleIds;
						splitAllocations = group.splitConfig.vehicleIds.map(id => ({ vehicleId: id }));
					} else {
						selectedVehicleIds = group.splitConfig.allocations.map(a => a.vehicleId);
						splitAllocations = group.splitConfig.allocations;
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
			const expenseDate = new Date(expense.date);
			formData.date = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}-${String(expenseDate.getDate()).padStart(2, '0')}`;
			formData.mileage = expense.mileage?.toString() ?? '';
			formData.volume = expense.volume?.toString() ?? '';
			formData.charge = expense.charge?.toString() ?? '';
			formData.fuelType = expense.fuelType || '';
			formData.description = expense.description || '';
			formData.isFinancingPayment = expense.isFinancingPayment ?? false;
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
			// Fetch the most recent fuel expenses server-side; grab 2 in case one is the current expense
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

	function selectCategory(categoryValue: string) {
		formData.category = categoryValue;
		touched['category'] = true;
		handleBlur('category');

		// Reset financing payment flag when switching away from financial category
		if (categoryValue !== 'financial') {
			formData.isFinancingPayment = false;
		}
	}

	// Reload vehicle data when vehicle selection changes (not on initial mount — onMount handles that)
	let previousVehicleId = $state('');
	$effect(() => {
		if (formData.vehicleId && formData.vehicleId !== previousVehicleId) {
			previousVehicleId = formData.vehicleId;
			// Skip if this is the initial load (onMount handles it)
			if (vehicle !== null || !isLoading) {
				// Reset financing flag when switching vehicles (new vehicle may not have financing)
				formData.isFinancingPayment = false;
				loadVehicle();
				loadLastFuelExpense();
				loadAllVehicleExpenses();
			}
		}
	});

	// Show fuel-specific fields when Fuel category is selected
	let showFuelFields = $derived(formData.category === 'fuel');

	// Show financing checkbox when category is 'financial' AND vehicle has active financing
	let showFinancingCheckbox = $derived(
		formData.category === 'financial' && vehicle?.financing?.isActive === true
	);

	// Determine which energy field to require based on the selected fuelType
	let showVolumeField = $derived(showFuelFields && !isElectricFuelType(formData.fuelType));
	let showChargeField = $derived(showFuelFields && isElectricFuelType(formData.fuelType));

	function handleMileageChange() {
		if (formData.category === 'fuel' && formData.mileage && lastFuelExpense?.mileage) {
			const milesDriven = parseInt(formData.mileage) - lastFuelExpense.mileage;

			if (milesDriven > 0) {
				// Calculate efficiency based on fuelType
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

	async function handleSubmit() {
		if (!validateForm()) {
			Object.keys(formData).forEach(field => {
				touched[field] = true;
			});
			return;
		}

		isSubmitting = true;

		try {
			// Convert date string to ISO format at noon local time to avoid timezone issues
			let dateISO: string;
			if (formData.date) {
				const parts = formData.date.split('-').map(Number);
				const year = parts[0] ?? 0;
				const month = parts[1] ?? 1;
				const day = parts[2] ?? 1;
				const localDate = new Date(year, month - 1, day, 12, 0, 0);
				dateISO = localDate.toISOString();
			} else {
				dateISO = new Date().toISOString();
			}

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
				currency: currencyUnit,
				isFinancingPayment: formData.isFinancingPayment,
				missedFillup: formData.missedFillup
			};

			if (isGroupEditMode && groupId) {
				// Update split expense group
				const splitConfig = buildSplitConfig();
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
				// Update existing expense using API service
				await expenseApi.updateExpense(expenseId!, expenseData);

				appStore.addNotification({
					type: 'success',
					message: 'Expense updated successfully'
				});
				gotoDynamic(returnTo);
			} else if (isSplit && selectedVehicleIds.length >= 2) {
				// Create split expense group
				const splitConfig = buildSplitConfig();
				const result = await expenseApi.createSplitExpense({
					splitConfig,
					category: formData.category as ExpenseCategory,
					tags: formData.tags.length > 0 ? formData.tags : undefined,
					date: dateISO,
					description: formData.description || undefined,
					totalAmount: parseFloat(formData.amount)
				});

				await uploadPendingPhotos('expense_group', result.group.id);

				appStore.addNotification({
					type: 'success',
					message: 'Split expense created successfully'
				});
				gotoDynamic(returnTo);
			} else {
				// Create new expense
				if (onlineStatus.current) {
					const created = await expenseApi.createExpense(expenseData);

					await uploadPendingPhotos('expense', created.id);

					appStore.addNotification({
						type: 'success',
						message: 'Expense added successfully'
					});
					gotoDynamic(returnTo);
				} else {
					// Save offline
					addOfflineExpense({
						vehicleId: expenseData.vehicleId,
						tags: expenseData.tags,
						category: expenseData.category,
						amount: expenseData.amount,
						date: expenseData.date ?? '',
						description: expenseData.description ?? '',
						...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
						...(expenseData.volume !== undefined && { volume: expenseData.volume }),
						...(expenseData.charge !== undefined && { charge: expenseData.charge })
					});

					requestBackgroundSync('expense-sync');

					appStore.addNotification({
						type: 'info',
						message: 'Expense saved offline. Will sync when online.'
					});

					gotoDynamic(returnTo);
				}
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to save expense:', error);

			if (!isEditMode) {
				// Save offline as fallback for new expenses
				const expenseData = {
					vehicleId: formData.vehicleId,
					tags: formData.tags,
					category: formData.category,
					amount: parseFloat(formData.amount),
					date: formData.date,
					mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
					volume: formData.volume ? parseFloat(formData.volume) : undefined,
					charge: formData.charge ? parseFloat(formData.charge) : undefined,
					fuelType: formData.fuelType || undefined,
					description: formData.description || undefined
				};

				addOfflineExpense({
					vehicleId: expenseData.vehicleId,
					tags: expenseData.tags,
					category: expenseData.category,
					amount: expenseData.amount,
					date: expenseData.date ?? '',
					description: expenseData.description ?? '',
					...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
					...(expenseData.volume !== undefined && { volume: expenseData.volume }),
					...(expenseData.charge !== undefined && { charge: expenseData.charge })
				});
				requestBackgroundSync('expense-sync');

				appStore.addNotification({
					type: 'warning',
					message: 'Saved offline due to connection issue. Will sync when online.'
				});

				gotoDynamic(returnTo);
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Network error. Please try again.'
				});
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
			// For insurance-managed expenses, delete the parent group (cascades children)
			if (isInsuranceManaged && groupId) {
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

	async function uploadPendingPhotos(
		entityType: 'expense' | 'expense_group',
		entityId: string
	): Promise<void> {
		if (pendingFiles.length === 0) return;
		let failCount = 0;
		for (const file of pendingFiles) {
			try {
				await expenseApi.uploadPhoto(entityType, entityId, file);
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
			// Populate with currently selected vehicle
			if (formData.vehicleId) {
				selectedVehicleIds = [formData.vehicleId];
			}
			splitMethod = 'even';
			splitAllocations = [];
		} else {
			// Reset to single vehicle mode
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
		resetAllocationsForMethod(method);
	}

	function resetAllocationsForMethod(method: 'even' | 'absolute' | 'percentage') {
		if (method === 'even') {
			splitAllocations = [];
		} else if (method === 'absolute') {
			splitAllocations = selectedVehicleIds.map(id => ({ vehicleId: id, amount: 0 }));
		} else {
			const pct = selectedVehicleIds.length > 0 ? 100 / selectedVehicleIds.length : 0;
			splitAllocations = selectedVehicleIds.map(id => ({
				vehicleId: id,
				percentage: Math.round(pct * 10) / 10
			}));
		}
	}

	function handleAllocationsChange(
		allocs: Array<{ vehicleId: string; amount?: number; percentage?: number }>
	) {
		splitAllocations = allocs;
	}

	function buildSplitConfig(): SplitConfig {
		if (splitMethod === 'even') {
			return { method: 'even', vehicleIds: selectedVehicleIds };
		} else if (splitMethod === 'absolute') {
			return {
				method: 'absolute',
				allocations: splitAllocations.map(a => ({
					vehicleId: a.vehicleId,
					amount: a.amount ?? 0
				}))
			};
		} else {
			return {
				method: 'percentage',
				allocations: splitAllocations.map(a => ({
					vehicleId: a.vehicleId,
					percentage: a.percentage ?? 0
				}))
			};
		}
	}
</script>

<FormLayout>
{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
	</div>
{:else if isInsuranceManaged}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={() => gotoDynamic(returnTo)} class="p-2 hover:bg-muted rounded-lg">
				<ArrowLeft class="h-5 w-5" />
			</button>
			<div>
				<h1 class="text-2xl font-bold text-foreground">Insurance Expense</h1>
				<p class="text-muted-foreground">This expense is managed by an insurance policy</p>
			</div>
		</div>

		<!-- Insurance managed banner -->
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
							if (insuranceTermId) queryObj['editTerm'] = insuranceTermId;
							gotoWithQuery(resolve(routes.insurance), queryObj);
						}}
					>
						<Shield class="mr-2 h-4 w-4" />
						Edit Insurance Term
					</Button>
				{/if}
			</div>
		</div>

		<!-- Read-only expense details -->
		<div class="rounded-lg border bg-card p-6 space-y-4">
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<p class="text-muted-foreground">Category</p>
					<p class="font-medium text-foreground">
						{categoryLabels[formData.category as keyof typeof categoryLabels] ?? formData.category}
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
					<p class="font-medium text-foreground">
						{new Date(formData.date || '').toLocaleDateString()}
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

		<!-- Photos (read-only but can still view) -->
		{#if groupId}
			<div class="rounded-lg border bg-card p-6">
				<ExpensePhotoSection entityType="expense_group" entityId={groupId} />
			</div>
		{/if}

		<!-- Back button -->
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
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={() => gotoDynamic(returnTo)} class="p-2 hover:bg-muted rounded-lg">
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

		<!-- Form -->
		<form
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
			class="rounded-lg border bg-card p-6 space-y-6"
		>
			<!-- Vehicle Selection / Split Summary -->
			{#if isSplit && selectedVehicleIds.length >= 2}
				<!-- Split configured: show tappable summary instead of vehicle dropdown -->
				<div class="space-y-2">
					<Label>Vehicle *</Label>
					<button
						type="button"
						onclick={() => (showSplitSheet = true)}
						class="flex w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3 text-left transition-colors hover:bg-muted"
					>
						<div class="flex items-center gap-2 min-w-0">
							<GitBranch class="h-4 w-4 shrink-0 text-muted-foreground" />
							<div class="min-w-0">
								<p class="text-sm font-medium text-foreground">{splitSummaryText}</p>
								<p class="truncate text-xs text-muted-foreground">
									{selectedVehicleIds
										.map(id => {
											const v = vehicles.find(veh => veh.id === id);
											return v ? getVehicleDisplayName(v) : id;
										})
										.join(', ')}
								</p>
							</div>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">Edit</span>
					</button>
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
				<!-- Normal single vehicle selector + split button inline -->
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
								onclick={() => {
									if (!isSplit) {
										handleSplitToggle(true);
									}
									showSplitSheet = true;
								}}
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

			<!-- Category Selection (Required) -->
			<CategorySelector
				value={formData.category}
				error={errors['category']}
				touched={touched['category']}
				onSelect={selectCategory}
			/>

			<!-- Financing Payment Checkbox -->
			{#if showFinancingCheckbox}
				<div class="flex items-center gap-3 rounded-lg border bg-muted/50 p-4">
					<Checkbox id="isFinancingPayment" bind:checked={formData.isFinancingPayment} />
					<Label for="isFinancingPayment" class="cursor-pointer text-sm font-medium leading-none">
						Apply as payment towards financing
					</Label>
				</div>
			{/if}

			<!-- Date -->
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

			<!-- Amount -->
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

			<!-- Mileage (always visible, required for fuel) -->
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
						aria-describedby={touched['mileage'] && errors['mileage'] ? 'mileage-error' : undefined}
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

			<!-- Fuel-specific fields -->
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

			<!-- Description -->
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

			<!-- Tags -->
			<TagInput bind:tags={formData.tags} error={errors['tags']} touched={touched['tags']} />

			<!-- Photos & Receipts -->
			{#if isGroupEditMode && groupId}
				<ExpensePhotoSection entityType="expense_group" entityId={groupId} />
			{:else if isEditMode && expenseId}
				<ExpensePhotoSection entityType="expense" entityId={expenseId} />
			{:else}
				<PendingPhotoPreview
					files={pendingFiles}
					onAdd={file => (pendingFiles = [...pendingFiles, file])}
					onRemove={i => (pendingFiles = pendingFiles.filter((_, idx) => idx !== i))}
				/>
			{/if}
		</form>

		<!-- Floating Action Bar -->
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
						<span class="hidden sm:inline font-semibold">Delete</span>
					</Button>
				{/if}

				<Button
					type="button"
					variant="outline"
					onclick={handleBack}
					disabled={isSubmitting || isDeleting}
					class="sm:rounded-full rounded-full bg-muted-foreground hover:bg-muted-foreground/80 text-background shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 border-0 flex-shrink-0"
				>
					<X class="h-5 w-5 sm:mr-2" />
					<span class="hidden sm:inline font-semibold">Cancel</span>
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

	<!-- Split Cost Sheet -->
	<SplitCostSheet
		bind:open={showSplitSheet}
		{vehicles}
		{selectedVehicleIds}
		{splitMethod}
		allocations={splitAllocations}
		totalAmount={parsedTotalAmount}
		onVehicleIdsChange={ids => {
			selectedVehicleIds = ids;
			resetAllocationsForMethod(splitMethod);
		}}
		onMethodChange={handleMethodChange}
		onAllocationsChange={handleAllocationsChange}
		onClose={() => (showSplitSheet = false)}
	/>
{/if}

<!-- Delete Confirmation AlertDialog (outside if/else so it works in all modes) -->
<AlertDialog.Root bind:open={showDeleteConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Expense</AlertDialog.Title>
			<AlertDialog.Description>
				{#if isInsuranceManaged && groupId}
					This will delete the insurance expense group and all its child expenses. This action
					cannot be undone.
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
							${originalExpense.amount.toFixed(2)} on {new Date(
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
