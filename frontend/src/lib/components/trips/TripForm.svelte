<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import { tripApi } from '$lib/services/trip-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { capitalize, dateOnlyToISO, toDateInputValue } from '$lib/utils/formatters';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { TRIP_PURPOSES, type Trip, type TripPurpose, type Vehicle } from '$lib/types';
	import {
		parseOdometer,
		validateTripFields,
		type TripFormData,
		type TripFormErrors
	} from './trip-form-validation';

	interface Props {
		open: boolean;
		vehicles: Vehicle[];
		onSaved: () => void;
		/** When set, the form edits this trip instead of creating one. */
		trip?: Trip | null;
	}

	let { open = $bindable(), vehicles, onSaved, trip = null }: Props = $props();

	let isEdit = $derived(!!trip);

	// Odometer inputs hold numbers or null at runtime, so their types admit all three; parseOdometer accepts each.
	let vehicleId = $state('');
	let startOdometer = $state<string | number | null>('');
	let endOdometer = $state<string | number | null>('');
	let purpose = $state<TripPurpose>('business');
	let tripDate = $state(toDateInputValue(new Date()));
	let startLocation = $state('');
	let endLocation = $state('');
	let note = $state('');

	let isSubmitting = $state(false);
	let errors = $state<TripFormErrors>({});

	// Falls back to the global unit preference when no vehicle is resolved yet.
	let unitLabel = $derived.by(() => {
		const v = vehicles.find(veh => veh.id === vehicleId);
		return getDistanceUnitLabel(
			(v?.unitPreferences ?? settingsStore.unitPreferences).distanceUnit,
			true
		);
	});

	// Keyed on open. Edit hydrates from the existing row so a never-populated field cannot wipe data on save.
	let lastOpen = $state(false);
	$effect(() => {
		if (open === lastOpen) return;
		lastOpen = open;
		if (!open) return;
		errors = {};
		if (trip) {
			vehicleId = trip.vehicleId;
			startOdometer = trip.startOdometer;
			endOdometer = trip.endOdometer;
			purpose = trip.purpose;
			tripDate = toDateInputValue(trip.tripDate);
			startLocation = trip.startLocation ?? '';
			endLocation = trip.endLocation ?? '';
			note = trip.note ?? '';
		} else {
			vehicleId = vehicles.length === 1 && vehicles[0] ? vehicles[0].id : '';
			startOdometer = '';
			endOdometer = '';
			purpose = 'business';
			tripDate = toDateInputValue(new Date());
			startLocation = '';
			endLocation = '';
			note = '';
		}
	});

	function currentForm(): TripFormData {
		return {
			vehicleId,
			startOdometer,
			endOdometer,
			purpose,
			tripDate,
			startLocation,
			endLocation,
			note
		};
	}

	async function handleSubmit() {
		errors = validateTripFields(currentForm());
		if (Object.keys(errors).length > 0) return;

		// Same parser as validation, which already guarantees non-null; ?? 0 only narrows the type.
		const startValue = parseOdometer(startOdometer) ?? 0;
		const endValue = parseOdometer(endOdometer) ?? 0;

		isSubmitting = true;
		try {
			const payload = {
				startOdometer: startValue,
				endOdometer: endValue,
				purpose,
				tripDate: dateOnlyToISO(tripDate),
				startLocation: startLocation.trim() || undefined,
				endLocation: endLocation.trim() || undefined,
				note: note.trim() || undefined
			};
			if (trip) {
				// Edit sends only editable fields: vehicleId is immutable and the backend re-syncs the linked odometer entry.
				await tripApi.update(trip.id, payload);
				appStore.addNotification({ type: 'success', message: 'Trip updated' });
			} else {
				await tripApi.create({ vehicleId, ...payload });
				appStore.addNotification({ type: 'success', message: 'Trip logged' });
			}
			open = false;
			onSaved();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to save trip:', error);
			appStore.addNotification({
				type: 'error',
				message: trip ? 'Failed to update trip' : 'Failed to log trip'
			});
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Edit Trip' : 'Log a Trip'}</Dialog.Title>
			<Dialog.Description>
				Record a trip's start and end odometer, purpose, and date. The end reading also updates the
				vehicle's odometer history.
			</Dialog.Description>
		</Dialog.Header>

		<form
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<div class="space-y-2">
				<Label for="trip-vehicle">Vehicle *</Label>
				{#if vehicles.length === 0}
					<p class="text-sm text-muted-foreground">Add a vehicle first to log a trip.</p>
				{:else if isEdit}
					<!-- A trip's vehicle is immutable, so it is shown read-only in edit. -->
					<Input
						id="trip-vehicle"
						value={getVehicleDisplayName(vehicles.find(v => v.id === vehicleId)) ?? 'Vehicle'}
						disabled
					/>
				{:else}
					<Select.Root type="single" bind:value={vehicleId}>
						<Select.Trigger id="trip-vehicle" class="w-full" aria-invalid={!!errors.vehicleId}>
							{vehicleId
								? (getVehicleDisplayName(vehicles.find(v => v.id === vehicleId)) ??
									'Select a vehicle')
								: 'Select a vehicle'}
						</Select.Trigger>
						<Select.Content>
							{#each vehicles as v (v.id)}
								<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
									{getVehicleDisplayName(v)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
				{#if errors.vehicleId}<FormFieldError>{errors.vehicleId}</FormFieldError>{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="trip-start">Start odometer *</Label>
					<div class="relative">
						<Input
							id="trip-start"
							type="number"
							min="0"
							bind:value={startOdometer}
							placeholder="0"
							class="pr-10"
							aria-invalid={!!errors.startOdometer}
						/>
						<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
							<span class="text-muted-foreground text-sm">{unitLabel}</span>
						</div>
					</div>
					{#if errors.startOdometer}<FormFieldError>{errors.startOdometer}</FormFieldError>{/if}
				</div>
				<div class="space-y-2">
					<Label for="trip-end">End odometer *</Label>
					<div class="relative">
						<Input
							id="trip-end"
							type="number"
							min="0"
							bind:value={endOdometer}
							placeholder="0"
							class="pr-10"
							aria-invalid={!!errors.endOdometer}
						/>
						<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
							<span class="text-muted-foreground text-sm">{unitLabel}</span>
						</div>
					</div>
					{#if errors.endOdometer}<FormFieldError>{errors.endOdometer}</FormFieldError>{/if}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="trip-purpose">Purpose *</Label>
					<Select.Root type="single" bind:value={purpose}>
						<Select.Trigger id="trip-purpose" class="w-full">
							{capitalize(purpose)}
						</Select.Trigger>
						<Select.Content>
							{#each TRIP_PURPOSES as p (p)}
								<Select.Item value={p} label={capitalize(p)}>{capitalize(p)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for="trip-date">Date *</Label>
					<DatePicker id="trip-date" bind:value={tripDate} placeholder="Select date" />
					{#if errors.tripDate}<FormFieldError>{errors.tripDate}</FormFieldError>{/if}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="trip-start-loc">From (optional)</Label>
					<Input
						id="trip-start-loc"
						bind:value={startLocation}
						placeholder="e.g. Home"
						aria-invalid={!!errors.startLocation}
					/>
					{#if errors.startLocation}<FormFieldError>{errors.startLocation}</FormFieldError>{/if}
				</div>
				<div class="space-y-2">
					<Label for="trip-end-loc">To (optional)</Label>
					<Input
						id="trip-end-loc"
						bind:value={endLocation}
						placeholder="e.g. Office"
						aria-invalid={!!errors.endLocation}
					/>
					{#if errors.endLocation}<FormFieldError>{errors.endLocation}</FormFieldError>{/if}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="trip-note">Notes (optional)</Label>
				<Textarea id="trip-note" bind:value={note} rows={2} placeholder="Any extra details…" />
				{#if errors.note}<FormFieldError>{errors.note}</FormFieldError>{/if}
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
						{isEdit ? 'Saving…' : 'Logging…'}
					{:else}
						{isEdit ? 'Save Trip' : 'Log Trip'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
