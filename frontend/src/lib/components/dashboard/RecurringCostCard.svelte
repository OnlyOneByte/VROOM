<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { Repeat, ArrowRight, CalendarClock } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { formatCurrency } from '$lib/utils/formatters';

	interface Props {
		/** Count of active expense reminders contributing a positive monthly run-rate. */
		count: number;
		/** Total normalized monthly run-rate across those reminders (currency/month). */
		monthlyTotal: number;
		isLoading?: boolean;
	}

	let { count, monthlyTotal, isLoading = false }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Recurring Costs</Card.Title>
				<Card.Description>Monthly run-rate from your recurring expenses</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-accent">
				<Repeat class="h-5 w-5 text-accent-foreground" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<Skeleton class="h-16 w-full" />
		{:else if count > 0}
			<div class="flex items-baseline gap-2">
				<span class="text-3xl font-bold">{formatCurrency(monthlyTotal)}</span>
				<span class="text-sm text-muted-foreground">/ month</span>
			</div>
			<p class="mt-1 text-sm text-muted-foreground inline-flex items-center gap-1">
				<CalendarClock class="h-3.5 w-3.5" />
				across {count} recurring expense{count !== 1 ? 's' : ''}
			</p>
			<div class="mt-4 pt-4 border-t">
				<Button href={resolve(routes.reminders)} variant="outline" class="w-full">
					View Recurring Expenses
					<ArrowRight class="h-4 w-4 ml-2" />
				</Button>
			</div>
		{:else}
			<EmptyState>
				{#snippet icon()}
					<Repeat class="h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					No recurring costs
				{/snippet}
				{#snippet description()}
					Create an expense-type reminder (insurance premium, loan payment) and its monthly run-rate
					will show up here.
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
