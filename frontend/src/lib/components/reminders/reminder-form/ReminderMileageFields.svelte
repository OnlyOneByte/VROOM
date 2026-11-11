<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import type { Vehicle } from '$lib/types';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { mileageUnitLabel } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
		vehicles: Vehicle[];
	}

	let { form, vehicles }: Props = $props();

	let unitLabel = $derived(mileageUnitLabel(vehicles, form.values.selectedVehicleIds[0]));
</script>

<div class="grid grid-cols-2 gap-3">
	<div class="space-y-2">
		<Label for="reminder-interval-mileage">Service interval *</Label>
		<div class="relative">
			<Input
				id="reminder-interval-mileage"
				type="number"
				min="1"
				bind:value={form.values.intervalMileage}
				placeholder="5000"
				class="pr-10"
				aria-invalid={!!form.errors['intervalMileage']}
			/>
			<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
				<span class="text-muted-foreground text-sm">{unitLabel}</span>
			</div>
		</div>
		{#if form.errors['intervalMileage']}<FormFieldError
				>{form.errors['intervalMileage']}</FormFieldError
			>{/if}
	</div>
	<div class="space-y-2">
		<Label for="reminder-last-service">Last serviced at</Label>
		<div class="relative">
			<Input
				id="reminder-last-service"
				type="number"
				min="0"
				bind:value={form.values.lastServiceOdometer}
				placeholder="current"
				class="pr-10"
				aria-invalid={!!form.errors['lastServiceOdometer']}
			/>
			<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
				<span class="text-muted-foreground text-sm">{unitLabel}</span>
			</div>
		</div>
		{#if form.errors['lastServiceOdometer']}<FormFieldError
				>{form.errors['lastServiceOdometer']}</FormFieldError
			>{/if}
	</div>
</div>
<p class="text-xs text-muted-foreground -mt-2">
	Leave “last serviced at” blank to use this vehicle’s latest odometer reading.
</p>
