<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.ts';

	interface Props {
		latestTermEnd: string;
	}

	let { latestTermEnd }: Props = $props();

	const DAY_MS = 24 * 60 * 60 * 1000;
	const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
	const EXPIRING_SOON_DAYS = 30;
	const URGENT_DAYS = 7;

	function localDayNumber(date: Date): number {
		return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
	}

	function calendarDaysUntil(value: string): number {
		const end = DATE_ONLY.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
		return localDayNumber(end) - localDayNumber(new Date());
	}

	let daysRemaining = $derived(calendarDaysUntil(latestTermEnd));
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
