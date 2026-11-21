<script lang="ts">
	import { Clock, CircleCheck, X, TriangleAlert } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as CardNs from '#lib/components/ui/card/index.ts';
	import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
	import { DISPLAY_LIMITS } from '#lib/constants/limits.ts';
	import { EXPENSE_MESSAGES } from '#lib/constants/messages.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getCategoryLabel } from '#lib/utils/chart-colors.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';

	interface Props {
		pendingExpenses: OfflineExpense[];
		needsAttentionExpenses?: OfflineExpense[];
		syncedExpenses: OfflineExpense[];
		onRemovePending: (_id: string) => void;
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

	let discardTarget = $state<{ expense: OfflineExpense; remove: (_id: string) => void } | null>(
		null
	);
	let confirmOpen = $state(false);

	function askToDiscard(expense: OfflineExpense, remove: (_id: string) => void) {
		discardTarget = { expense, remove };
		confirmOpen = true;
	}

	function describeEntry(expense: OfflineExpense): string {
		return `${formatCurrency(expense.amount)} ${getCategoryLabel(expense.category)} on ${formatDate(expense.date)}`;
	}
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
						<Button
							variant="ghost"
							size="icon-lg"
							onclick={() => askToDiscard(expense, onRemovePending)}
							class="-m-3 flex-shrink-0 text-muted-foreground hover:text-destructive"
							aria-label="Discard pending expense"
							title="Discard pending expense"
						>
							<X class="h-4 w-4" />
						</Button>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary">
									{getCategoryLabel(expense.category)}
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
					<div
						class="flex items-center gap-3 p-3 bg-warning/10 border border-warning/20 rounded-lg"
					>
						<Button
							variant="ghost"
							size="icon-lg"
							onclick={() => askToDiscard(expense, removeNeedsAttention)}
							class="-m-3 flex-shrink-0 text-muted-foreground hover:text-destructive"
							aria-label="Discard this entry"
							title="Discard this entry"
						>
							<X class="h-4 w-4" />
						</Button>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<Badge variant="secondary">{getCategoryLabel(expense.category)}</Badge>
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
								<Badge variant="secondary">
									{getCategoryLabel(expense.category)}
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

<ConfirmDialog
	bind:open={confirmOpen}
	title="Discard this unsynced expense?"
	description={discardTarget
		? `${describeEntry(discardTarget.expense)} was never synced to the server. Discarding it deletes it and any photos attached to it from this device for good.`
		: ''}
	confirmLabel="Discard"
	onConfirm={() => {
		if (discardTarget) discardTarget.remove(discardTarget.expense.id);
	}}
/>
