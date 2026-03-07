<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { LoaderCircle } from '@lucide/svelte';
	import { PERIOD_OPTIONS, isValidPeriod, type TimePeriod } from '$lib/constants/time-periods';

	interface Props {
		selectedPeriod: TimePeriod;
		isLoading: boolean;
		onPeriodChange: (_period: TimePeriod) => void;
	}

	let { selectedPeriod, isLoading, onPeriodChange }: Props = $props();

	let selectedPeriodOption = $derived(PERIOD_OPTIONS.find(opt => opt.value === selectedPeriod));
</script>

<div class="flex justify-end">
	<Select.Root
		type="single"
		value={selectedPeriod}
		onValueChange={value => {
			if (value && isValidPeriod(value)) {
				onPeriodChange(value);
			}
		}}
	>
		<Select.Trigger class="w-[180px]" disabled={isLoading} aria-label="Select time period">
			<span class="flex items-center gap-2">
				{#if isLoading}
					<LoaderCircle class="h-4 w-4 animate-spin" />
				{/if}
				{selectedPeriodOption?.label || 'Select period'}
			</span>
		</Select.Trigger>
		<Select.Content>
			{#each PERIOD_OPTIONS as option (option.value)}
				<Select.Item value={option.value} label={option.label}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>
