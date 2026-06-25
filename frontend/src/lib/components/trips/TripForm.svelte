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
	import { TRIP_PURPOSES, type TripPurpose, type Vehicle } from '$lib/types';
	import {
		parseOdometer,
		validateTripFields,
		type TripFormData,
		type TripFormErrors
	} from './trip-form-validation';

	interface Props {
		open: boolean;
		vehicles: Vehicle[];
		/** Called after a successful create so the parent can refetch. */
		onSaved: () => void;
	}

	let { open = $bindable(), vehicles, onSaved }: Props = $props();

	// Form fields. The odometer fields bind to `<input type="number">`, which Svelte coerces to a NUMBER
	// (or null when cleared) — so they're typed `string | number | null` even though seeded ''; parseOdometer
	// tolerates all three (the C230 fix). Everything else is a plain string the inputs bind.
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

	// The distance-unit label of the selected vehicle (trip odometers are stored same-unit-as-the-vehicle,
	// R2) — falls back to the global pref when no vehicle is resolved yet (the per-vehicle-units idiom).
	let unitLabel = $derived.by(() => {
		const v = vehicles.find((veh) => veh.id === vehicleId);
		return getDistanceUnitLabel(
			(v?.unitPreferences ?? settingsStore.unitPreferences).distanceUnit,
			true
		);
	});

	// Re-seed the form whenever it opens, so each create starts blank (defaulting to the only vehicle when
	// the user owns exactly one + today's date). Keyed on `open` so reopening after cancel resets cleanly.
	let lastOpen = $state(false);
	$effect(() => {
		if (open === lastOpen) return;
		lastOpen = open;
		if (!open) return;
		errors = {};
		vehicleId = vehicles.length === 1 && vehicles[0] ? vehicles[0].id : '';
		startOdometer = '';
		endOdometer = '';
		purpose = 'business';
		tripDate = toDateInputValue(new Date());
		startLocation = '';
		endLocation = '';
		note = '';
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

		// Parse via the SAME helper validation used (not a divergent parseInt — which would disagree on
		// e.g. '1e3'); validation already guaranteed both are non-null, the ?? 0 is a type-narrowing floor.
		const startValue = parseOdometer(startOdometer) ?? 0;
		const endValue = parseOdometer(endOdometer) ?? 0;

		isSubmitting = true;
		try {
			await tripApi.create({
				vehicleId,
				startOdometer: startValue,
				endOdometer: endValue,
				purpose,
				// The backend reads this as noon-local (dateOnlyToISO), so "today" is accepted (the C226 fix).
				tripDate: dateOnlyToISO(tripDate),
				startLocation: startLocation.trim() || undefined,
				endLocation: endLocation.trim() || undefined,
				note: note.trim() || undefined
			});
			appStore.addNotification({ type: 'success', message: 'Trip logged' });
			open = false;
			onSaved();
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to create trip:', error);
			appStore.addNotification({ type: 'error', message: 'Failed to log trip' });
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Log a Trip</Dialog.Title>
			<Dialog.Description>
				Record a trip's start and end odometer, purpose, and date. The end reading also updates the
				vehicle's odometer history.
			</Dialog.Description>
		</Dialog.Header>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<!-- Vehicle -->
			<div class="space-y-2">
				<Label for="trip-vehicle">Vehicle *</Label>
				{#if vehicles.length === 0}
					<p class="text-sm text-muted-foreground">Add a vehicle first to log a trip.</p>
				{:else}
					<Select.Root type="single" bind:value={vehicleId}>
						<Select.Trigger id="trip-vehicle" class="w-full" aria-invalid={!!errors.vehicleId}>
							{vehicleId
								? (getVehicleDisplayName(vehicles.find((v) => v.id === vehicleId)) ?? 'Select a vehicle')
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

			<!-- Odometer pair -->
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

			<!-- Purpose + date -->
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

			<!-- Optional locations -->
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

			<!-- Note (optional) -->
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
						Logging…
					{:else}
						Log Trip
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
