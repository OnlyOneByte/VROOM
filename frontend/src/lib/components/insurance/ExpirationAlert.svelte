<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { getDaysRemaining, isExpiringSoon } from '$lib/utils/insurance';

	interface Props {
		currentTermEnd: string;
	}

	let { currentTermEnd }: Props = $props();

	let daysRemaining = $derived(getDaysRemaining(currentTermEnd));
	let expiring = $derived(isExpiringSoon(currentTermEnd));
	let isUrgent = $derived(daysRemaining <= 7);
</script>

{#if expiring}
	<Badge
		variant="outline"
		class={isUrgent ? 'text-destructive border-destructive' : 'text-chart-5 border-chart-5'}
	>
		{#if daysRemaining <= 0}
			Expired
		{:else if daysRemaining === 1}
			Expires tomorrow
		{:else}
			{daysRemaining} days left
		{/if}
	</Badge>
{/if}
