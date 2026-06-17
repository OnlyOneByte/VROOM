<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import TagInput from '$lib/components/expenses/form/TagInput.svelte';
	import SplitConfigEditor from '$lib/components/expenses/split/SplitConfigEditor.svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import { reminderApi } from '$lib/services/reminder-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { capitalize, dateOnlyToISO, toDateInputValue } from '$lib/utils/formatters';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { categoryLabels, resetSplitAllocations } from '$lib/utils/expense-helpers';
	import type { SplitAllocationDraft } from '$lib/utils/expense-helpers';
	import type { ExpenseCategory, ReminderWithVehicles, Vehicle } from '$lib/types';
	import type { ReminderSplitConfig, TriggerMode } from '$lib/types/reminder';

	interface Props {
		open: boolean;
		/** When set, the form edits this reminder; otherwise it creates a new one. */
		reminder?: ReminderWithVehicles | null;
		vehicles: Vehicle[];
		/** Called after a successful create/edit so the parent can refetch. */
		onSaved: () => void;
	}

	let { open = $bindable(), reminder = null, vehicles, onSaved }: Props = $props();

	const FREQUENCIES = ['weekly', 'monthly', 'yearly', 'custom'] as const;
	const INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;
	const EXPENSE_CATEGORIES = [
		'fuel',
		'maintenance',
		'financial',
		'regulatory',
		'enhancement',
		'misc'
	] as const satisfies readonly ExpenseCategory[];

	type Frequency = (typeof FREQUENCIES)[number];
	type IntervalUnit = (typeof INTERVAL_UNITS)[number];
	type ReminderKind = 'notification' | 'expense';

	let isEdit = $derived(!!reminder);

	// Form fields. type 'notification' just notifies; type 'expense' auto-creates
	// an expense (category + amount, applied to the vehicle[s]) when due. When an
	// expense reminder spans >1 vehicle, the optional expenseSplitConfig (T4) controls
	// how the materialized amount is divided per vehicle (even / fixed-$ / %), reusing
	// the same SplitConfigEditor as the expense + insurance-term forms.
	let kind = $state<ReminderKind>('notification');
	let name = $state('');
	let description = $state('');
	// Trigger axis (maintenance-schedule): by time, by odometer mileage, or both. 'time' is the
	// default + keeps the form behaving exactly as before. Mileage/both reveal the mileage fields and
	// constrain to a single vehicle (the odometer is per-vehicle, D4).
	let triggerMode = $state<TriggerMode>('time');
	let intervalMileage = $state('');
	let lastServiceOdometer = $state('');
	let frequency = $state<Frequency>('monthly');
	let intervalValue = $state('');
	let intervalUnit = $state<IntervalUnit>('month');
	let startDate = $state(toDateInputValue(new Date()));
	let endDate = $state('');
	let selectedVehicleIds = $state<string[]>([]);

	// Which axes are active. The time fields (frequency/dates) only matter when the time axis is on;
	// the mileage fields only when the mileage axis is on.
	let hasTimeAxis = $derived(triggerMode === 'time' || triggerMode === 'both');
	let hasMileageAxis = $derived(triggerMode === 'mileage' || triggerMode === 'both');

	// The distance-unit label of the single selected vehicle (mileage requires exactly one). Falls
	// back to 'mi' when no vehicle is resolved yet.
	let mileageUnitLabel = $derived.by(() => {
		const v = vehicles.find(veh => veh.id === selectedVehicleIds[0]);
		return getDistanceUnitLabel(v?.unitPreferences?.distanceUnit ?? 'miles', true);
	});
	// Expense-type fields (only used/validated when kind === 'expense').
	let expenseCategory = $state<ExpenseCategory>('financial');
	let expenseAmount = $state('');
	let expenseTags = $state<string[]>([]);

	// Multi-vehicle split (T4): how an expense reminder divides its amount across vehicles.
	// 'even' carries no per-vehicle rows (backend splits via largest-remainder cents); 'absolute'/
	// 'percentage' carry per-vehicle allocations. resetSplitAllocations is the shared source of truth
	// (C415) so the seed can't drift from the expense/insurance forms.
	let splitMethod = $state<'even' | 'absolute' | 'percentage'>('even');
	let splitAllocations = $state<SplitAllocationDraft[]>([]);
	// The split editor is only relevant for an expense reminder spanning ≥2 vehicles with a positive
	// amount; a single-vehicle expense reminder keeps the no-split (null config) path unchanged.
	let splitVehicles = $derived(vehicles.filter(v => selectedVehicleIds.includes(v.id)));
	let parsedExpenseAmount = $derived(parseFloat(expenseAmount) || 0);
	let showSplitEditor = $derived(
		kind === 'expense' && parsedExpenseAmount > 0 && selectedVehicleIds.length >= 2
	);

	let isSubmitting = $state(false);
	let errors = $state<Record<string, string>>({});

	// Re-seed the form whenever it opens (or the target reminder changes), so an
	// edit shows current values and a create starts blank. Keyed on `open` so
	// reopening after a cancel resets cleanly.
	let lastKey = $state('');
	$effect(() => {
		const key = `${open}:${reminder?.reminder.id ?? 'new'}`;
		if (key === lastKey) return;
		lastKey = key;
		if (!open) return;
		errors = {};
		if (reminder) {
			const r = reminder.reminder;
			kind = r.type === 'expense' ? 'expense' : 'notification';
			name = r.name;
			description = r.description ?? '';
			triggerMode = (['time', 'mileage', 'both'] as const).includes(r.triggerMode as TriggerMode)
				? (r.triggerMode as TriggerMode)
				: 'time';
			intervalMileage = r.intervalMileage != null ? String(r.intervalMileage) : '';
			lastServiceOdometer = r.lastServiceOdometer != null ? String(r.lastServiceOdometer) : '';
			frequency = (FREQUENCIES as readonly string[]).includes(r.frequency)
				? (r.frequency as Frequency)
				: 'monthly';
			intervalValue = r.intervalValue != null ? String(r.intervalValue) : '';
			intervalUnit = (INTERVAL_UNITS as readonly string[]).includes(r.intervalUnit ?? '')
				? (r.intervalUnit as IntervalUnit)
				: 'month';
			// Read the stored ISO back as the LOCAL calendar date (not a bare UTC .slice(0,10)). The save
			// path persists via dateOnlyToISO → NOON LOCAL (:205-206), so for a UTC+13/+14 user noon-local
			// lands on the prior UTC day and `.slice(0,10)` would show the day before — shifting the date
			// back every edit-open (#131, the #87/#106 family). toDateInputValue reads local Y/M/D, matching
			// the create path (:66/:134) and the C267/C268/C271 sibling-form fixes.
			startDate = toDateInputValue(new Date(r.startDate));
			endDate = r.endDate ? toDateInputValue(new Date(r.endDate)) : '';
			selectedVehicleIds = [...reminder.vehicleIds];
			expenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(r.expenseCategory ?? '')
				? (r.expenseCategory as ExpenseCategory)
				: 'financial';
			expenseAmount = r.expenseAmount != null ? String(r.expenseAmount) : '';
			expenseTags = r.expenseTags ? [...r.expenseTags] : [];
			// Seed the split editor from the stored config: 'even' has no per-vehicle rows; absolute/
			// percentage carry their allocations. A null config (single-vehicle / unsplit) defaults to even.
			const sc = r.expenseSplitConfig;
			if (sc && sc.method !== 'even') {
				splitMethod = sc.method;
				splitAllocations = sc.allocations.map(a => ({ ...a }));
			} else {
				splitMethod = 'even';
				splitAllocations = [];
			}
		} else {
			kind = 'notification';
			name = '';
			description = '';
			triggerMode = 'time';
			intervalMileage = '';
			lastServiceOdometer = '';
			frequency = 'monthly';
			intervalValue = '';
			intervalUnit = 'month';
			startDate = toDateInputValue(new Date());
			endDate = '';
			// Default to the only vehicle when the user owns exactly one.
			selectedVehicleIds = vehicles.length === 1 && vehicles[0] ? [vehicles[0].id] : [];
			expenseCategory = 'financial';
			expenseAmount = '';
			expenseTags = [];
			splitMethod = 'even';
			splitAllocations = [];
		}
	});

	function toggleVehicle(id: string) {
		selectedVehicleIds = selectedVehicleIds.includes(id)
			? selectedVehicleIds.filter(v => v !== id)
			: [...selectedVehicleIds, id];
		// Re-seed split allocations to the new vehicle set so absolute/percentage rows track the
		// selection (mirrors the expense + insurance-term forms' toggle behavior).
		splitAllocations = resetSplitAllocations(splitMethod, selectedVehicleIds);
	}

	function handleSplitMethodChange(method: 'even' | 'absolute' | 'percentage') {
		splitMethod = method;
		splitAllocations = resetSplitAllocations(method, selectedVehicleIds);
	}

	function handleAllocationsChange(allocs: SplitAllocationDraft[]) {
		splitAllocations = allocs;
	}

	// Build the ReminderSplitConfig payload — null unless this is a multi-vehicle expense reminder with
	// an editor showing. 'even' carries vehicleIds; absolute/percentage carry their allocations.
	function buildSplitConfig(): ReminderSplitConfig | null {
		if (!showSplitEditor) return null;
		if (splitMethod === 'even') {
			return { method: 'even', vehicleIds: selectedVehicleIds };
		}
		if (splitMethod === 'absolute') {
			return {
				method: 'absolute',
				allocations: splitAllocations.map(a => ({ vehicleId: a.vehicleId, amount: a.amount ?? 0 }))
			};
		}
		return {
			method: 'percentage',
			allocations: splitAllocations.map(a => ({
				vehicleId: a.vehicleId,
				percentage: a.percentage ?? 0
			}))
		};
	}

	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!name.trim()) e['name'] = 'Name is required';
		if (selectedVehicleIds.length === 0) e['vehicleIds'] = 'Select at least one vehicle';
		// D4: the mileage axis is per-vehicle → exactly one vehicle when mileage is involved.
		if (hasMileageAxis && selectedVehicleIds.length > 1) {
			e['vehicleIds'] = 'A mileage reminder must track exactly one vehicle';
		}
		// Custom interval only matters when the time axis is active.
		if (hasTimeAxis && frequency === 'custom') {
			const n = parseInt(intervalValue, 10);
			if (!Number.isInteger(n) || n < 1) e['intervalValue'] = 'Enter a positive interval';
		}
		// Mileage axis: a positive service interval is required (the milestone driver).
		if (hasMileageAxis) {
			const m = parseInt(intervalMileage, 10);
			if (!Number.isInteger(m) || m < 1)
				e['intervalMileage'] = 'Enter a positive distance interval';
			if (lastServiceOdometer.trim() !== '') {
				const last = parseInt(lastServiceOdometer, 10);
				if (!Number.isInteger(last) || last < 0)
					e['lastServiceOdometer'] = 'Enter a valid odometer reading';
			}
		}
		if (endDate && startDate && new Date(endDate) <= new Date(startDate)) {
			e['endDate'] = 'End date must be after the start date';
		}
		if (kind === 'expense') {
			const amt = parseFloat(expenseAmount);
			if (!(amt > 0)) e['expenseAmount'] = 'Enter an amount greater than 0';
			// Multi-vehicle split sums must reconcile (mirrors the backend refineSplitConfig so we block
			// before a 400): percentages → 100; fixed-$ → the expense amount. 'even' needs no check.
			if (showSplitEditor && splitMethod === 'percentage') {
				const sum = splitAllocations.reduce((s, a) => s + (a.percentage ?? 0), 0);
				if (Math.abs(sum - 100) > 0.01) e['split'] = 'Split percentages must total 100%';
			}
			if (showSplitEditor && splitMethod === 'absolute' && amt > 0) {
				const sum = splitAllocations.reduce((s, a) => s + (a.amount ?? 0), 0);
				if (Math.abs(sum - amt) > 0.01) e['split'] = 'Split amounts must total the expense amount';
			}
		}
		errors = e;
		return Object.keys(e).length === 0;
	}

	async function handleSubmit() {
		if (!validate()) return;
		isSubmitting = true;
		try {
			const isExpense = kind === 'expense';
			const payload = {
				name: name.trim(),
				description: description.trim() || null,
				type: kind,
				triggerMode,
				// Mileage axis: send the interval when active, else null (clears on edit when switching to
				// pure time). lastServiceOdometer is OMITTED when blank so the backend defaults it to the
				// vehicle's current odometer (D4); sent when the user typed an explicit anchor.
				intervalMileage: hasMileageAxis ? parseInt(intervalMileage, 10) : null,
				...(hasMileageAxis && lastServiceOdometer.trim() !== ''
					? { lastServiceOdometer: parseInt(lastServiceOdometer, 10) }
					: {}),
				frequency,
				intervalValue: frequency === 'custom' ? parseInt(intervalValue, 10) : null,
				intervalUnit: frequency === 'custom' ? intervalUnit : null,
				startDate: dateOnlyToISO(startDate),
				endDate: endDate ? dateOnlyToISO(endDate) : null,
				vehicleIds: selectedVehicleIds,
				// Expense template: sent only for expense reminders; explicitly null on
				// a notification reminder so switching type on edit clears stale values.
				expenseCategory: isExpense ? expenseCategory : null,
				expenseAmount: isExpense ? parseFloat(expenseAmount) : null,
				expenseTags: isExpense && expenseTags.length > 0 ? expenseTags : null,
				// Multi-vehicle split (T4): the per-vehicle division for an expense reminder spanning ≥2
				// vehicles; null for a notification, single-vehicle, or unsplit expense reminder (so the
				// trigger materializes one row on vehicleIds[0], unchanged). Explicit null on edit clears
				// a stale config when the reminder drops back to one vehicle / notification.
				expenseSplitConfig: isExpense ? buildSplitConfig() : null
			};
			if (reminder) {
				await reminderApi.update(reminder.reminder.id, payload);
				appStore.addNotification({ type: 'success', message: 'Reminder updated' });
			} else {
				await reminderApi.create(payload);
				appStore.addNotification({ type: 'success', message: 'Reminder created' });
			}
			open = false;
			onSaved();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to save reminder:', error);
			appStore.addNotification({
				type: 'error',
				message: `Failed to ${isEdit ? 'update' : 'create'} reminder`
			});
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Edit Reminder' : 'New Reminder'}</Dialog.Title>
			<Dialog.Description>
				Get notified about recurring maintenance or events on your vehicles.
			</Dialog.Description>
		</Dialog.Header>

		<form
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<!-- Type: notification (just notify) vs expense (auto-create an expense) -->
			<div class="space-y-2">
				<Label for="reminder-type">Type *</Label>
				<Select.Root type="single" bind:value={kind}>
					<Select.Trigger id="reminder-type" class="w-full">
						{kind === 'expense' ? 'Recurring expense' : 'Notification'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="notification" label="Notification">Notification</Select.Item>
						<Select.Item value="expense" label="Recurring expense">Recurring expense</Select.Item>
					</Select.Content>
				</Select.Root>
				<p class="text-xs text-muted-foreground">
					{kind === 'expense'
						? 'Auto-creates an expense on each due date (e.g. insurance premium, loan payment).'
						: 'Just notifies you when due (e.g. rotate tires, renew registration).'}
				</p>
			</div>

			<!-- Name -->
			<div class="space-y-2">
				<Label for="reminder-name">Name *</Label>
				<Input
					id="reminder-name"
					bind:value={name}
					placeholder={kind === 'expense' ? 'e.g. Car insurance premium' : 'e.g. Rotate tires'}
					aria-invalid={!!errors['name']}
				/>
				{#if errors['name']}<FormFieldError>{errors['name']}</FormFieldError>{/if}
			</div>

			<!-- Trigger axis: by time, by odometer mileage, or whichever comes first -->
			<div class="space-y-2">
				<Label for="reminder-trigger-mode">Trigger when</Label>
				<Select.Root type="single" bind:value={triggerMode}>
					<Select.Trigger id="reminder-trigger-mode" class="w-full">
						{triggerMode === 'mileage'
							? 'At a mileage interval'
							: triggerMode === 'both'
								? 'Time or mileage (whichever first)'
								: 'On a time schedule'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="time" label="On a time schedule">On a time schedule</Select.Item>
						<Select.Item value="mileage" label="At a mileage interval">
							At a mileage interval
						</Select.Item>
						<Select.Item value="both" label="Time or mileage (whichever first)">
							Time or mileage (whichever first)
						</Select.Item>
					</Select.Content>
				</Select.Root>
				<p class="text-xs text-muted-foreground">
					{triggerMode === 'mileage'
						? 'Due when the odometer reaches the next service milestone.'
						: triggerMode === 'both'
							? 'Due on the date OR the mileage milestone, whichever arrives first.'
							: 'Due on a recurring date schedule.'}
				</p>
			</div>

			<!-- Expense template (expense type only): category + amount + tags -->
			{#if kind === 'expense'}
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="reminder-expense-category">Category *</Label>
						<Select.Root type="single" bind:value={expenseCategory}>
							<Select.Trigger id="reminder-expense-category" class="w-full">
								{categoryLabels[expenseCategory]}
							</Select.Trigger>
							<Select.Content>
								{#each EXPENSE_CATEGORIES as c (c)}
									<Select.Item value={c} label={categoryLabels[c]}>{categoryLabels[c]}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label for="reminder-expense-amount">Amount *</Label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
								<span class="text-muted-foreground">$</span>
							</div>
							<Input
								id="reminder-expense-amount"
								type="number"
								step="0.01"
								min="0"
								bind:value={expenseAmount}
								placeholder="0.00"
								class="pl-8"
								aria-invalid={!!errors['expenseAmount']}
							/>
						</div>
						{#if errors['expenseAmount']}<FormFieldError>{errors['expenseAmount']}</FormFieldError
							>{/if}
					</div>
				</div>
				<TagInput bind:tags={expenseTags} />
			{/if}

			<!-- Mileage interval (mileage / both axes) -->
			{#if hasMileageAxis}
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="reminder-interval-mileage">Service interval *</Label>
						<div class="relative">
							<Input
								id="reminder-interval-mileage"
								type="number"
								min="1"
								bind:value={intervalMileage}
								placeholder="5000"
								class="pr-10"
								aria-invalid={!!errors['intervalMileage']}
							/>
							<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
								<span class="text-muted-foreground text-sm">{mileageUnitLabel}</span>
							</div>
						</div>
						{#if errors['intervalMileage']}<FormFieldError
								>{errors['intervalMileage']}</FormFieldError
							>{/if}
					</div>
					<div class="space-y-2">
						<Label for="reminder-last-service">Last serviced at</Label>
						<div class="relative">
							<Input
								id="reminder-last-service"
								type="number"
								min="0"
								bind:value={lastServiceOdometer}
								placeholder="current"
								class="pr-10"
								aria-invalid={!!errors['lastServiceOdometer']}
							/>
							<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
								<span class="text-muted-foreground text-sm">{mileageUnitLabel}</span>
							</div>
						</div>
						{#if errors['lastServiceOdometer']}<FormFieldError
								>{errors['lastServiceOdometer']}</FormFieldError
							>{/if}
					</div>
				</div>
				<p class="text-xs text-muted-foreground -mt-2">
					Leave “last serviced at” blank to use this vehicle’s latest odometer reading.
				</p>
			{/if}

			<!-- Frequency (time / both axes) -->
			{#if hasTimeAxis}
				<div class="space-y-2">
					<Label for="reminder-frequency">Frequency *</Label>
					<Select.Root type="single" bind:value={frequency}>
						<Select.Trigger id="reminder-frequency" class="w-full">
							{capitalize(frequency)}
						</Select.Trigger>
						<Select.Content>
							{#each FREQUENCIES as f (f)}
								<Select.Item value={f} label={capitalize(f)}>
									{capitalize(f)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Custom interval (only for custom frequency) -->
				{#if frequency === 'custom'}
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="reminder-interval-value">Every</Label>
							<Input
								id="reminder-interval-value"
								type="number"
								min="1"
								bind:value={intervalValue}
								placeholder="3"
								aria-invalid={!!errors['intervalValue']}
							/>
							{#if errors['intervalValue']}<FormFieldError>{errors['intervalValue']}</FormFieldError
								>{/if}
						</div>
						<div class="space-y-2">
							<Label for="reminder-interval-unit">Unit</Label>
							<Select.Root type="single" bind:value={intervalUnit}>
								<Select.Trigger id="reminder-interval-unit" class="w-full">
									{intervalUnit}{intervalValue && parseInt(intervalValue, 10) > 1 ? 's' : ''}
								</Select.Trigger>
								<Select.Content>
									{#each INTERVAL_UNITS as u (u)}
										<Select.Item value={u} label={u}>{u}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}

				<!-- Start date -->
				<div class="space-y-2">
					<Label for="reminder-start">Start date *</Label>
					<DatePicker id="reminder-start" bind:value={startDate} placeholder="Select start date" />
				</div>

				<!-- End date (optional) -->
				<div class="space-y-2">
					<Label for="reminder-end">End date (optional)</Label>
					<DatePicker id="reminder-end" bind:value={endDate} placeholder="No end date" />
					{#if errors['endDate']}<FormFieldError>{errors['endDate']}</FormFieldError>{/if}
				</div>
			{/if}

			<!-- Vehicles -->
			<div class="space-y-2">
				<Label>Vehicles *</Label>
				{#if vehicles.length === 0}
					<p class="text-sm text-muted-foreground">Add a vehicle first to create a reminder.</p>
				{:else}
					<div class="rounded-md border border-input p-3 space-y-2 max-h-40 overflow-y-auto">
						{#each vehicles as v (v.id)}
							<label class="flex items-center gap-2 cursor-pointer">
								<Checkbox
									checked={selectedVehicleIds.includes(v.id)}
									onCheckedChange={() => toggleVehicle(v.id)}
								/>
								<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
							</label>
						{/each}
					</div>
				{/if}
				{#if errors['vehicleIds']}<FormFieldError>{errors['vehicleIds']}</FormFieldError>{/if}
			</div>

			<!-- Multi-vehicle split (expense reminder spanning ≥2 vehicles): how the materialized
			     amount divides per vehicle. Single-vehicle keeps the no-split path (editor hidden). -->
			{#if showSplitEditor}
				<div class="space-y-2">
					<Label>Split across vehicles</Label>
					<SplitConfigEditor
						vehicles={splitVehicles}
						totalAmount={parsedExpenseAmount}
						{splitMethod}
						allocations={splitAllocations}
						onMethodChange={handleSplitMethodChange}
						onAllocationsChange={handleAllocationsChange}
					/>
					{#if errors['split']}<FormFieldError>{errors['split']}</FormFieldError>{/if}
				</div>
			{/if}

			<!-- Description (optional) -->
			<div class="space-y-2">
				<Label for="reminder-description">Notes (optional)</Label>
				<Textarea
					id="reminder-description"
					bind:value={description}
					rows={2}
					placeholder="Any extra details…"
				/>
			</div>

			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => (open = false)}
					disabled={isSubmitting}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={isSubmitting || vehicles.length === 0}>
					{#if isSubmitting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						{isEdit ? 'Saving…' : 'Creating…'}
					{:else}
						{isEdit ? 'Save Changes' : 'Create Reminder'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
