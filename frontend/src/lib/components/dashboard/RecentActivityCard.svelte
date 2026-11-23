<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Clock } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { formatCurrency, formatDateWith } from '#lib/utils/formatters.ts';
	import { categoryLabels } from '#lib/utils/expense-helpers.ts';
	import type { ExpenseCategory } from '#lib/types/index.ts';

	interface RecentExpense {
		id: string;
		amount: number;
		category: ExpenseCategory;
		date: Date;
		description?: string | null;
		location?: string | null;
		vehicleName: string;
	}

	interface Props {
		expenses: RecentExpense[];
		isLoading?: boolean;
	}

	let { expenses, isLoading = false }: Props = $props();

	function headline(expense: RecentExpense): string {
		return (
			expense.description?.trim() || expense.location?.trim() || categoryLabels[expense.category]
		);
	}
</script>

<Card.Root class="gap-3 py-5">
	<Card.Header class="flex flex-row items-center justify-between gap-3 px-5">
		<Card.Title level={2} class="text-lg">Recent</Card.Title>
		{#if expenses.length > 0}
			<a
				href={resolve(routes.expenses)}
				class="inline-flex min-h-10 items-center rounded-sm text-sm font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-0"
			>
				See all<span class="sr-only"> expenses</span>
			</a>
		{/if}
	</Card.Header>
	<Card.Content class="px-5">
		{#if isLoading}
			<ul class="divide-y" role="list" aria-busy="true">
				{#each Array(3) as _, i (i)}
					<li class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
						<div class="space-y-1.5">
							<Skeleton class="h-4 w-32" />
							<Skeleton class="h-3 w-44" />
						</div>
						<Skeleton class="h-4 w-14" />
					</li>
				{/each}
			</ul>
		{:else if expenses.length > 0}
			<ul class="divide-y" role="list">
				{#each expenses as expense (expense.id)}
					<li class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-foreground">{headline(expense)}</p>
							<p class="truncate text-xs text-muted-foreground">
								{[
									headline(expense) === categoryLabels[expense.category]
										? null
										: categoryLabels[expense.category],
									expense.vehicleName,
									formatDateWith(expense.date, { month: 'short', day: 'numeric' })
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</div>
						<p class="shrink-0 text-sm font-semibold tabular-nums text-foreground">
							{formatCurrency(expense.amount)}
						</p>
					</li>
				{/each}
			</ul>
		{:else}
			<EmptyState level={3} class="border-0 py-0 shadow-none">
				{#snippet icon()}
					<Clock class="mb-4 h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					No expenses yet
				{/snippet}
				{#snippet description()}
					Log a fill-up or any cost and it shows here.
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
