<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Clock, ArrowRight } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { formatCurrency, formatRelativeTime } from '#lib/utils/formatters.ts';
	import {
		categoryLabels,
		getCategoryBadgeClasses,
		getCategoryIcon
	} from '#lib/utils/expense-helpers.ts';
	import type { ExpenseCategory } from '#lib/types/index.ts';

	interface RecentExpense {
		id: string;
		amount: number;
		category: ExpenseCategory;
		date: Date;
		description?: string | null;
		vehicleName: string;
	}

	interface Props {
		expenses: RecentExpense[];
		isLoading?: boolean;
	}

	let { expenses, isLoading = false }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Recent Activity</Card.Title>
				<Card.Description>Latest expenses across all vehicles</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-accent">
				<Clock class="h-5 w-5 text-accent-foreground" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="space-y-3">
				{#each Array(5) as _, i (i)}
					<Skeleton class="h-16 w-full" />
				{/each}
			</div>
		{:else if expenses.length > 0}
			<div class="space-y-3">
				{#each expenses as expense (expense.id)}
					{@const CategoryIcon = getCategoryIcon(expense.category)}
					<div
						class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 mb-1">
								<!-- Tinted label text fails WCAG AA; only the icon chip takes the category colour. -->
								<span
									class="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium {getCategoryBadgeClasses(
										expense.category
									)}"
								>
									<CategoryIcon class="h-3 w-3" />
									<span class="text-foreground">{categoryLabels[expense.category]}</span>
								</span>
								<span class="text-sm font-medium truncate">{expense.vehicleName}</span>
							</div>
							{#if expense.description}
								<p class="text-sm text-muted-foreground truncate">{expense.description}</p>
							{/if}
							<p class="text-xs text-muted-foreground mt-1">
								{formatRelativeTime(expense.date)}
							</p>
						</div>
						<div class="text-right ml-4">
							<p class="text-lg font-bold">{formatCurrency(expense.amount)}</p>
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-4 pt-4 border-t">
				<Button href={resolve(routes.expenses)} variant="outline" class="w-full">
					View All Expenses
					<ArrowRight class="h-4 w-4 ml-2" />
				</Button>
			</div>
		{:else}
			<EmptyState>
				{#snippet icon()}
					<Clock class="h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					No recent activity
				{/snippet}
				{#snippet description()}
					Add expenses to see recent activity
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
