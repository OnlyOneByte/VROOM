<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { Bell, BellRing, ArrowRight, Calendar } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';

	interface DueReminder {
		id: string;
		name: string;
		nextDueDate: string;
		isOverdue: boolean;
		expenseAmount: number | null;
		vehicleNames: string;
	}

	interface Props {
		reminders: DueReminder[];
		isLoading?: boolean;
	}

	let { reminders, isLoading = false }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Upcoming Reminders</Card.Title>
				<Card.Description>Recurring expenses and maintenance due soon</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-accent">
				<BellRing class="h-5 w-5 text-accent-foreground" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="space-y-3">
				{#each Array(3) as _, i (i)}
					<Skeleton class="h-16 w-full" />
				{/each}
			</div>
		{:else if reminders.length > 0}
			<div class="space-y-3">
				{#each reminders as reminder (reminder.id)}
					<div
						class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
					>
						<div class="flex items-start gap-3 min-w-0 flex-1">
							<div class="mt-0.5 {reminder.isOverdue ? 'text-warning' : 'text-muted-foreground'}">
								{#if reminder.isOverdue}
									<BellRing class="h-5 w-5" />
								{:else}
									<Bell class="h-5 w-5" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium truncate">{reminder.name}</span>
									{#if reminder.isOverdue}
										<Badge variant="secondary" class="bg-warning/10 text-warning text-xs">Due now</Badge>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
									<Calendar class="h-3.5 w-3.5" />
									{reminder.isOverdue ? 'Due' : 'Next'}: {formatDate(reminder.nextDueDate)}
									{#if reminder.vehicleNames}
										· {reminder.vehicleNames}
									{/if}
								</p>
							</div>
						</div>
						{#if reminder.expenseAmount != null}
							<div class="text-right ml-4 shrink-0">
								<p class="text-sm font-semibold">{formatCurrency(reminder.expenseAmount)}</p>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="mt-4 pt-4 border-t">
				<Button href={resolve(routes.reminders)} variant="outline" class="w-full">
					View All Reminders
					<ArrowRight class="h-4 w-4 ml-2" />
				</Button>
			</div>
		{:else}
			<EmptyState>
				{#snippet icon()}
					<Bell class="h-12 w-12 text-muted-foreground" />
				{/snippet}
				{#snippet title()}
					Nothing due soon
				{/snippet}
				{#snippet description()}
					Reminders due in the next two weeks will show up here.
				{/snippet}
			</EmptyState>
		{/if}
	</Card.Content>
</Card.Root>
