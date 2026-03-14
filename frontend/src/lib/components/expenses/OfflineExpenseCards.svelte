<script lang="ts">
	import { Clock, CircleCheck, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import type { OfflineExpense } from '$lib/utils/offline-storage';
	import { DISPLAY_LIMITS } from '$lib/constants/limits';
	import { EXPENSE_MESSAGES } from '$lib/constants/messages';

	interface Props {
		pendingExpenses: OfflineExpense[];
		syncedExpenses: OfflineExpense[];
		onRemovePending: (_id: string) => void;
	}

	let { pendingExpenses, syncedExpenses, onRemovePending }: Props = $props();
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
									{expense.date}
								</span>
							</div>
							<div class="text-sm text-muted-foreground">
								${expense.amount.toFixed(2)}
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
									{expense.date}
								</span>
							</div>
							<div class="text-sm text-muted-foreground">
								${expense.amount.toFixed(2)}
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
