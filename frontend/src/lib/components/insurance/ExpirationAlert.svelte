<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { getDaysRemaining } from '#lib/utils/insurance.ts';

	interface Props {
		latestTermEnd: string;
	}

	let { latestTermEnd }: Props = $props();

	const EXPIRING_SOON_DAYS = 30;
	const URGENT_DAYS = 7;

	let daysRemaining = $derived(getDaysRemaining(latestTermEnd));
	let isUrgent = $derived(daysRemaining <= URGENT_DAYS);
</script>

{#if daysRemaining < 0}
	<Badge variant="outline" class="text-destructive border-destructive">Expired</Badge>
{:else if daysRemaining <= EXPIRING_SOON_DAYS}
	<Badge
		variant="outline"
		class={isUrgent ? 'text-destructive border-destructive' : 'text-chart-5 border-chart-5'}
	>
		{#if daysRemaining === 0}
			Expires today
		{:else if daysRemaining === 1}
			Expires tomorrow
		{:else}
			{daysRemaining} days left
		{/if}
	</Badge>
{/if}
