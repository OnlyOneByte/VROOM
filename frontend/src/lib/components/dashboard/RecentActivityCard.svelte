<script lang="ts">
	import { Clock, ArrowRight } from 'lucide-svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { formatCurrency, formatRelativeTime } from '$lib/utils/formatters';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import type { ExpenseCategory } from '$lib/types';

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

	const categoryColors: Record<ExpenseCategory, string> = {
		fuel: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
		maintenance: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
		financial: 'bg-green-500/10 text-green-700 dark:text-green-400',
		regulatory: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
		enhancement: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
		misc: 'bg-muted text-muted-foreground'
	};
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Recent Activity</Card.Title>
				<Card.Description>Latest expenses across all vehicles</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-purple-50">
				<Clock class="h-5 w-5 text-purple-600" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="space-y-3">
				{#each Array(5) as _}
					<Skeleton class="h-16 w-full" />
				{/each}
			</div>
		{:else if expenses.length > 0}
			<div class="space-y-3">
				{#each expenses as expense (expense.id)}
					<div
						class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary" class="{categoryColors[expense.category]} text-xs">
									{categoryLabels[expense.category]}
								</Badge>
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
				<Button href="/expenses" variant="outline" class="w-full">
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
