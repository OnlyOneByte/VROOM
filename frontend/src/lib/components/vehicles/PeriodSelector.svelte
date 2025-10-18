<script lang="ts">
	import * as Select from '$lib/components/ui/select';
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
					<span
						class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
					></span>
				{/if}
				{selectedPeriodOption?.label || 'Select period'}
			</span>
		</Select.Trigger>
		<Select.Content>
			{#each PERIOD_OPTIONS as option}
				<Select.Item value={option.value} label={option.label}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>
