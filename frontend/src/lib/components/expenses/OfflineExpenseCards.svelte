<script lang="ts">
	import { Clock, CircleCheck, X, TriangleAlert } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import type { OfflineExpense } from '$lib/utils/offline-storage';
	import { DISPLAY_LIMITS } from '$lib/constants/limits';
	import { EXPENSE_MESSAGES } from '$lib/constants/messages';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';

	interface Props {
		pendingExpenses: OfflineExpense[];
		/** Rows parked as permanently-unsyncable (#79) — surfaced so the user can fix or discard them. */
		needsAttentionExpenses?: OfflineExpense[];
		syncedExpenses: OfflineExpense[];
		onRemovePending: (_id: string) => void;
		/** Discard a needs-attention row. Defaults to onRemovePending (same removeOfflineExpense path). */
		onRemoveNeedsAttention?: (_id: string) => void;
	}

	let {
		pendingExpenses,
		needsAttentionExpenses = [],
		syncedExpenses,
		onRemovePending,
		onRemoveNeedsAttention
	}: Props = $props();

	const removeNeedsAttention = $derived(onRemoveNeedsAttention ?? onRemovePending);
</script>

{#if pendingExpenses.length > 0}
	<CardNs.Root>
		<CardNs.Header>
			<div class="flex items-center justify-between">
				<div>
					<CardNs.Title>
						{EXPENSE_MESSAGES.PENDING_SYNC} ({pendingExpenses.length})
					</CardNs.Title>
					<CardNs.Description>These expenses are waiting to be synced</CardNs.Description>
				</div>
				<div class="p-2 rounded-lg bg-chart-5/10">
					<Clock class="h-5 w-5 text-chart-5" />
				</div>
			</div>
		</CardNs.Header>
		<CardNs.Content>
			<div class="space-y-3">
				{#each pendingExpenses as expense (expense.id)}
					<div
						class="flex items-center gap-3 p-3 bg-chart-5/10 border border-chart-5/20 rounded-lg"
					>
						<button
							onclick={() => onRemovePending(expense.id)}
							class="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
							title="Delete pending expense"
						>
							<X class="h-4 w-4" />
						</button>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary" class="capitalize">
									{expense.category}
								</Badge>
								{#if expense.tags && expense.tags.length > 0}
									<span class="text-sm text-muted-foreground">
										{expense.tags.join(', ')}
									</span>
								{/if}
								<span class="text-sm text-muted-foreground">
									{formatDate(expense.date)}
								</span>
							</div>
							<div class="text-sm text-muted-foreground">
								{formatCurrency(expense.amount)}
								{#if expense.description}
									• {expense.description}
								{/if}
							</div>
						</div>
						<Clock class="h-4 w-4 text-chart-5 flex-shrink-0" />
					</div>
				{/each}
			</div>
		</CardNs.Content>
	</CardNs.Root>
{/if}

{#if needsAttentionExpenses.length > 0}
	<CardNs.Root>
		<CardNs.Header>
			<div class="flex items-center justify-between">
				<div>
					<CardNs.Title>Needs attention ({needsAttentionExpenses.length})</CardNs.Title>
					<CardNs.Description>
						These offline entries can't sync as-is (a fuel entry needs its fuel amount — volume or
						charge — and mileage). Edit the expense to add the missing info, or discard it.
					</CardNs.Description>
				</div>
				<div class="p-2 rounded-lg bg-warning/10">
					<TriangleAlert class="h-5 w-5 text-warning" />
				</div>
			</div>
		</CardNs.Header>
		<CardNs.Content>
			<div class="space-y-3">
				{#each needsAttentionExpenses as expense (expense.id)}
					<div class="flex items-center gap-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
						<button
							onclick={() => removeNeedsAttention(expense.id)}
							class="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
							title="Discard this entry"
						>
							<X class="h-4 w-4" />
						</button>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary" class="capitalize">{expense.category}</Badge>
								{#if expense.tags && expense.tags.length > 0}
									<span class="text-sm text-muted-foreground">{expense.tags.join(', ')}</span>
								{/if}
								<span class="text-sm text-muted-foreground">{formatDate(expense.date)}</span>
							</div>
							<div class="text-sm text-muted-foreground">
								{formatCurrency(expense.amount)}
								{#if expense.description}
									• {expense.description}
								{/if}
							</div>
						</div>
						<TriangleAlert class="h-4 w-4 text-warning flex-shrink-0" />
					</div>
				{/each}
			</div>
		</CardNs.Content>
	</CardNs.Root>
{/if}

{#if syncedExpenses.length > 0}
	<CardNs.Root>
		<CardNs.Header>
			<div class="flex items-center justify-between">
				<div>
					<CardNs.Title>
						{EXPENSE_MESSAGES.RECENTLY_SYNCED} ({syncedExpenses.length})
					</CardNs.Title>
					<CardNs.Description>Successfully synced to the server</CardNs.Description>
				</div>
				<div class="p-2 rounded-lg bg-chart-2/10">
					<CircleCheck class="h-5 w-5 text-chart-2" />
				</div>
			</div>
		</CardNs.Header>
		<CardNs.Content>
			<div class="space-y-3">
				{#each syncedExpenses.slice(0, DISPLAY_LIMITS.RECENT_SYNCED_EXPENSES) as expense (expense.id)}
					<div
						class="flex items-center justify-between p-3 bg-chart-2/10 border border-chart-2/20 rounded-lg"
					>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary" class="capitalize">
									{expense.category}
								</Badge>
								{#if expense.tags && expense.tags.length > 0}
									<span class="text-sm text-muted-foreground">
										{expense.tags.join(', ')}
									</span>
								{/if}
								<span class="text-sm text-muted-foreground">
									{formatDate(expense.date)}
								</span>
							</div>
							<div class="text-sm text-muted-foreground">
								{formatCurrency(expense.amount)}
								{#if expense.description}
									• {expense.description}
								{/if}
							</div>
						</div>
						<CircleCheck class="h-4 w-4 text-chart-2" />
					</div>
				{/each}
			</div>
		</CardNs.Content>
	</CardNs.Root>
{/if}
