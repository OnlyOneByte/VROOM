<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Clock } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
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
		vehicleName?: string;
		syncNote?: string;
	}

	interface Props {
		expenses: RecentExpense[];
		title?: string;
		totalCount?: number | undefined;
		onSeeAll?: (() => void) | undefined;
	}

	let { expenses, title = 'Recent', totalCount, onSeeAll }: Props = $props();

	const seeAllClass =
		'inline-flex min-h-10 items-center rounded-sm text-sm font-semibold text-accent-ink underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-0';

	function headline(expense: RecentExpense): string {
		return (
			expense.description?.trim() || expense.location?.trim() || categoryLabels[expense.category]
		);
	}
</script>

<Card.Root variant="section">
	<Card.Header class="flex flex-row items-center justify-between gap-3">
		<Card.Title level={2} class="text-base">{title}</Card.Title>
		{#if expenses.length > 0}
			{#if onSeeAll}
				<button type="button" class={seeAllClass} onclick={onSeeAll}>
					See all{totalCount ? ` ${totalCount}` : ''}<span class="sr-only"> expenses</span>
				</button>
			{:else}
				<a href={resolve(routes.expenses)} class={seeAllClass}>
					See all{totalCount ? ` ${totalCount}` : ''}<span class="sr-only"> expenses</span>
				</a>
			{/if}
		{/if}
	</Card.Header>
	<Card.Content>
		{#if expenses.length > 0}
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
							{#if expense.syncNote}
								<p
									class="text-xs font-medium {expense.syncNote === 'Not saved'
										? 'text-destructive'
										: 'text-muted-foreground'}"
								>
									{expense.syncNote}
								</p>
							{/if}
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
