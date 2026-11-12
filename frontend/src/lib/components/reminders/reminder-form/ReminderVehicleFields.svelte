<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import SplitConfigEditor from '$lib/components/expenses/split/SplitConfigEditor.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { Vehicle } from '$lib/types';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { parsedExpenseAmount } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
		vehicles: Vehicle[];
	}

	let { form, vehicles }: Props = $props();

	let splitVehicles = $derived(vehicles.filter(v => form.values.selectedVehicleIds.includes(v.id)));
	let totalAmount = $derived(parsedExpenseAmount(form.values.expenseAmount));
</script>

<div class="space-y-2">
	<Label>Vehicles *</Label>
	{#if vehicles.length === 0}
		<p class="text-sm text-muted-foreground">Add a vehicle first to create a reminder.</p>
	{:else}
		<div class="rounded-md border border-input p-3 space-y-2 max-h-40 overflow-y-auto">
			{#each vehicles as v (v.id)}
				<label class="flex items-center gap-2 cursor-pointer">
					<Checkbox
						checked={form.values.selectedVehicleIds.includes(v.id)}
						onCheckedChange={() => form.toggleVehicle(v.id)}
					/>
					<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
				</label>
			{/each}
		</div>
	{/if}
	{#if form.errors['vehicleIds']}<FormFieldError>{form.errors['vehicleIds']}</FormFieldError>{/if}
</div>

{#if form.showSplitEditor}
	<div class="space-y-2">
		<Label>Split across vehicles</Label>
		<SplitConfigEditor
			vehicles={splitVehicles}
			{totalAmount}
			splitMethod={form.values.splitMethod}
			allocations={form.values.splitAllocations}
			onMethodChange={method => form.setSplitMethod(method)}
			onAllocationsChange={allocations => form.setSplitAllocations(allocations)}
		/>
		{#if form.errors['split']}<FormFieldError>{form.errors['split']}</FormFieldError>{/if}
	</div>
{/if}
