<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import SplitConfigEditor from '#lib/components/expenses/split/SplitConfigEditor.svelte';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import type { Vehicle } from '#lib/types/index.ts';
	import type { ReminderFormState } from './reminder-form-state.svelte';
	import { parsedExpenseAmount } from './reminder-form-model';

	interface Props {
		form: ReminderFormState;
		vehicles: Vehicle[];
	}

	let { form, vehicles }: Props = $props();

	let splitVehicles = $derived(
		form.values.selectedVehicleIds.flatMap(id => vehicles.find(v => v.id === id) ?? [])
	);
	let totalAmount = $derived(parsedExpenseAmount(form.values.expenseAmount));
</script>

<div class="space-y-2">
	<Label id="reminder-vehicles-label">Vehicles *</Label>
	{#if vehicles.length === 0}
		<p class="text-sm text-muted-foreground">Add a vehicle first to create a reminder.</p>
	{:else}
		<div
			role="group"
			aria-labelledby="reminder-vehicles-label"
			aria-describedby={form.errors['vehicleIds'] ? 'reminder-vehicles-error' : undefined}
			class="rounded-md border border-input p-3 space-y-2 max-h-64 overflow-y-auto"
		>
			{#each vehicles as v (v.id)}
				<label class="flex min-h-10 items-center gap-2 cursor-pointer">
					<Checkbox
						checked={form.values.selectedVehicleIds.includes(v.id)}
						onCheckedChange={() => form.toggleVehicle(v.id)}
						aria-invalid={!!form.errors['vehicleIds']}
					/>
					<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
				</label>
			{/each}
		</div>
	{/if}
	{#if form.errors['vehicleIds']}<FormFieldError id="reminder-vehicles-error">
			{form.errors['vehicleIds']}
		</FormFieldError>{/if}
</div>

{#if form.showSplitEditor}
	<div class="space-y-2">
		<Label id="reminder-split-label">Split across vehicles</Label>
		<div
			role="group"
			tabindex="-1"
			class="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-labelledby="reminder-split-label"
			aria-describedby={form.errors['split'] ? 'reminder-split-error' : undefined}
			data-invalid={form.errors['split'] ? 'true' : undefined}
		>
			<SplitConfigEditor
				vehicles={splitVehicles}
				{totalAmount}
				splitMethod={form.values.splitMethod}
				allocations={form.values.splitAllocations}
				onMethodChange={method => form.setSplitMethod(method)}
				onAllocationsChange={allocations => form.setSplitAllocations(allocations)}
			/>
		</div>
		{#if form.errors['split']}<FormFieldError id="reminder-split-error">
				{form.errors['split']}
			</FormFieldError>{/if}
	</div>
{/if}
