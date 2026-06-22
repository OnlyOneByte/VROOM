<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { Receipt, CircleAlert, Car } from '@lucide/svelte';
	import { reminderApi } from '$lib/services/reminder-api';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import type { Expense, ExpenseCategory } from '$lib/types';

	interface Props {
		open: boolean;
		/** The reminder whose materialized expenses to show (null when closed). */
		reminderId: string | null;
		reminderName: string;
		/** reminderId → display name resolution is the parent's job; this maps vehicleId → name. */
		vehicleNames: Map<string, string>;
	}

	let { open = $bindable(), reminderId, reminderName, vehicleNames }: Props = $props();

	let isLoading = $state(false);
	let loadError = $state<string | null>(null);
	let expenses = $state<Expense[]>([]);

	// Fetch (recurring-expenses T6 "materialized N expenses" view) whenever the dialog opens for a
	// reminder. Keyed on `open:reminderId` so re-opening a different reminder re-fetches, and closing
	// then re-opening the same one refreshes. The seam (GET /reminders/:id/expenses → findBySource) is
	// ownership-checked + user-scoped server-side (C122).
	let lastKey = $state('');
	$effect(() => {
		const key = `${open}:${reminderId ?? ''}`;
		if (key === lastKey) return;
		lastKey = key;
		if (!open || !reminderId) return;
		void load(reminderId);
	});

	async function load(id: string) {
		isLoading = true;
		loadError = null;
		try {
			expenses = await reminderApi.getMaterializedExpenses(id);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load materialized expenses:', error);
			loadError = error instanceof Error ? error.message : 'Failed to load expenses';
		} finally {
			isLoading = false;
		}
	}

	let total = $derived(expenses.reduce((sum, e) => sum + e.amount, 0));
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Receipt class="h-5 w-5" aria-hidden="true" />
				Materialized expenses
			</Dialog.Title>
			<Dialog.Description>
				Expenses auto-created by “{reminderName}”.
			</Dialog.Description>
		</Dialog.Header>

		{#if isLoading}
			<div class="space-y-2">
				{#each Array(3) as _, i (i)}
					<Skeleton class="h-12 w-full" />
				{/each}
			</div>
		{:else if loadError}
			<div class="rounded-lg border bg-card p-4">
				<div class="mb-3 flex items-center gap-2 text-destructive">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">Failed to load expenses</p>
				</div>
				<p class="mb-3 text-sm text-muted-foreground">{loadError}</p>
				{#if reminderId}
					<Button onclick={() => reminderId && load(reminderId)}>Retry</Button>
				{/if}
			</div>
		{:else if expenses.length > 0}
			<div class="space-y-2">
				<div class="flex items-center justify-between px-1 text-sm text-muted-foreground">
					<span>{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</span>
					<span class="font-medium text-foreground">{formatCurrency(total)} total</span>
				</div>
				<div class="divide-y rounded-md border">
					{#each expenses as expense (expense.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<p class="text-sm font-medium truncate">
									{categoryLabels[expense.category as ExpenseCategory] ?? expense.category}
								</p>
								<p class="text-xs text-muted-foreground inline-flex items-center gap-1">
									{formatDate(expense.date)}
									{#if vehicleNames.get(expense.vehicleId)}
										· <Car class="h-3 w-3" />
										{vehicleNames.get(expense.vehicleId)}
									{/if}
								</p>
							</div>
							<span class="text-sm font-semibold whitespace-nowrap">
								{formatCurrency(expense.amount)}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<EmptyState>
				{#snippet icon()}
					<Receipt class="h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					No expenses yet
				{/snippet}
				{#snippet description()}
					This reminder hasn’t materialized any expenses yet. They appear here once it fires on its
					due date.
				{/snippet}
			</EmptyState>
		{/if}
	</Dialog.Content>
</Dialog.Root>
