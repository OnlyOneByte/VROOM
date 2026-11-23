<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { Bell, BellRing, ArrowRight, Calendar, Plus } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';

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

{#if reminders.length === 0}
	<Card.Root class="py-4" data-testid="coming-up-empty">
		<Card.Content class="flex items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<Bell class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div class="min-w-0">
					<Card.Title level={2} class="text-base font-semibold">Coming Up</Card.Title>
					<p class="text-sm text-muted-foreground">Nothing due in the next two weeks</p>
				</div>
			</div>
			<Button
				variant="ghost"
				size="lg"
				href={resolve(routes.reminders)}
				class="shrink-0 max-sm:size-10 max-sm:px-0"
			>
				<Plus class="h-4 w-4 sm:mr-2" />
				<span class="max-sm:sr-only">Add reminder</span>
			</Button>
		</Card.Content>
	</Card.Root>
{:else}
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
											<Badge variant="secondary" class="bg-warning/10 text-warning text-xs">
												Due now
											</Badge>
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
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
