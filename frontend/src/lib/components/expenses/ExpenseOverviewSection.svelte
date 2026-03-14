<script lang="ts">
	import type { Component } from 'svelte';
	import { TrendingUp, ChevronDown, Receipt } from '@lucide/svelte';
	import * as CardNs from '$lib/components/ui/card';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { StatCardGrid } from '$lib/components/charts';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { ExpenseSummary, ExpenseCategory } from '$lib/types';
	import { EXPENSE_MESSAGES } from '$lib/constants/messages';

	interface Props {
		summary: ExpenseSummary | null;
		statCards: Array<{ label: string; value: string; icon: Component; iconColor: string }>;
	}

	let { summary, statCards }: Props = $props();

	let overviewOpen = $state(false);
</script>

<CardNs.Root>
	<Collapsible bind:open={overviewOpen}>
		<CardNs.Header class="pb-0">
			<CollapsibleTrigger class="flex items-center justify-between w-full">
				<div class="flex items-center gap-3">
					<div class="p-2 rounded-lg bg-chart-1/10">
						<TrendingUp class="h-5 w-5 text-chart-1" />
					</div>
					<div class="text-left">
						<CardNs.Title>Expense Overview</CardNs.Title>
						<CardNs.Description>
							{formatCurrency(summary?.totalAmount ?? 0)} across {summary?.expenseCount ?? 0}
							expense{(summary?.expenseCount ?? 0) !== 1 ? 's' : ''}
						</CardNs.Description>
					</div>
				</div>
				<ChevronDown
					class="h-5 w-5 text-muted-foreground transition-transform duration-200 {overviewOpen
						? 'rotate-180'
						: ''}"
				/>
			</CollapsibleTrigger>
		</CardNs.Header>
		<CollapsibleContent>
			<CardNs.Content class="space-y-6">
				<!-- Stats Grid -->
				<StatCardGrid items={statCards} columns={4} />

				<!-- Category Breakdown -->
				{#if summary && summary.categoryBreakdown.length > 0}
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<Receipt class="h-4 w-4 text-muted-foreground" />
							<p class="text-sm font-medium">
								{EXPENSE_MESSAGES.EXPENSES_BY_CATEGORY}
							</p>
						</div>
						<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
							{#each summary.categoryBreakdown as item (item.category)}
								{@const IconComponent = getCategoryIcon(item.category as ExpenseCategory)}
								<div class="p-3 rounded-lg border hover:bg-muted/50 transition-colors">
									<div class="flex items-center gap-2">
										<div
											class="p-1.5 rounded-lg {getCategoryColor(
												item.category as ExpenseCategory
											)} shrink-0"
										>
											<IconComponent class="h-3.5 w-3.5" />
										</div>
										<span class="text-xs sm:text-sm font-medium">
											{categoryLabels[item.category as ExpenseCategory]}
										</span>
									</div>
									<p class="text-sm font-bold mt-1.5">
										{formatCurrency(item.amount)}
									</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</CardNs.Content>
		</CollapsibleContent>
	</Collapsible>
</CardNs.Root>
