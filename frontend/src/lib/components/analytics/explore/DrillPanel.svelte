<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, Car, Fuel } from '@lucide/svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
	import { expensesQuery } from './explore-data';
	import type { AnalyticsBucketItems, AnalyticsBucketItemsParams } from '#lib/types/index.ts';
	import { getCategoryLabel } from '#lib/utils/chart-colors.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';

	interface Props {
		open: boolean;
		title: string;
		value?: string;
		comparison?: string;
		params: AnalyticsBucketItemsParams | null;
		expenses: { start: number; end: number; vehicleId?: string; tag?: string } | null;
		expensesNote?: string;
		costLabel?: string;
		valueFromItems?: 'total' | 'count';
		car?: { id: string; name: string } | null;
		parts?: Array<{
			key: string;
			label: string;
			value: string;
			color: string;
			action: string;
			run: () => void;
		}>;
		onOnlyCar?: (_id: string) => void;
		onClose: () => void;
	}

	let {
		open,
		title,
		value,
		comparison,
		params,
		expenses,
		expensesNote,
		costLabel,
		valueFromItems,
		car,
		parts = [],
		onOnlyCar,
		onClose
	}: Props = $props();

	const isMobile = new IsMobile();
	let items = $state<AnalyticsBucketItems | null>(null);
	let error = $state<string | null>(null);
	let request = 0;

	async function load(next: AnalyticsBucketItemsParams) {
		const current = ++request;
		items = null;
		error = null;
		try {
			const result = await analyticsApi.queryItems(next);
			if (current === request) items = result;
		} catch (e) {
			if (current === request) error = userFacingErrorMessage(e);
		}
	}

	$effect(() => {
		if (open && params) void load(params);
	});

	let expensesHref = $derived(
		items && items.count > 0 && expenses
			? expensesQuery({
					...expenses,
					categories:
						items.categories.length < EXPENSE_CATEGORIES.length ? items.categories : undefined
				})
			: null
	);
</script>

<Sheet.Root
	{open}
	onOpenChange={next => {
		if (!next) onClose();
	}}
>
	<Sheet.Content
		side={isMobile.current ? 'bottom' : 'right'}
		class={isMobile.current ? 'max-h-[85vh] overflow-y-auto' : 'overflow-y-auto sm:max-w-md'}
	>
		<Sheet.Header>
			<Sheet.Title>{title}</Sheet.Title>
			<Sheet.Description>
				{#if value}{value}{:else if items && valueFromItems === 'total'}{formatCurrency(
						items.total
					)}{:else if items && valueFromItems === 'count'}{items.count}
					{items.count === 1 ? 'expense' : 'expenses'}{/if}{#if comparison}<span class="block">
						{comparison}
					</span>{/if}
			</Sheet.Description>
		</Sheet.Header>

		<div class="space-y-3 px-4">
			{#if error}
				<LoadErrorCard
					title="Couldn't load these expenses"
					message={error}
					onRetry={() => params && load(params)}
				/>
			{:else if !items}
				<div class="space-y-2" aria-busy="true" aria-label="Loading the expenses">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
				</div>
			{:else if items.count === 0}
				<p class="text-sm text-muted-foreground">No expenses in this period.</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					{#if costLabel}{costLabel}:{/if}
					{formatCurrency(items.total)} from {items.count}
					{items.count === 1 ? 'expense' : 'expenses'}
				</p>
				<ul class="divide-y rounded-md border" aria-label="Largest expenses">
					{#if items.fuel}
						<li class="flex items-center justify-between gap-3 p-3">
							<span class="flex min-w-0 items-center gap-2">
								<Fuel class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span class="min-w-0">
									<span class="block font-medium">Fuel & charging</span>
									<span class="block text-xs text-muted-foreground">
										{items.fuel.count}
										{items.fuel.count === 1 ? 'fill-up or charge' : 'fill-ups and charges'}
									</span>
								</span>
							</span>
							<span class="shrink-0 font-medium tabular-nums">
								{formatCurrency(items.fuel.total)}
							</span>
						</li>
					{/if}
					{#each items.items as item (item.id)}
						<li class="flex items-center justify-between gap-3 p-3">
							<span class="min-w-0">
								<span class="block truncate font-medium">
									{item.description || getCategoryLabel(item.category)}
								</span>
								<span class="block truncate text-xs text-muted-foreground">
									{getCategoryLabel(item.category)} · {item.vehicleName} · {formatDate(
										new Date(item.date * 1000)
									)}
								</span>
							</span>
							<span class="shrink-0 font-medium tabular-nums">{formatCurrency(item.amount)}</span>
						</li>
					{/each}
					{#if items.others}
						<li class="flex items-center justify-between gap-3 p-3 text-muted-foreground">
							<span>
								{items.others.count} more {items.others.count === 1 ? 'expense' : 'expenses'}
							</span>
							<span class="shrink-0 tabular-nums">{formatCurrency(items.others.total)}</span>
						</li>
					{/if}
				</ul>
			{/if}

			{#if parts.length > 1}
				<ul class="divide-y rounded-md border" aria-label="Split of this period">
					{#each parts as part (part.key)}
						<li class="flex items-center justify-between gap-3 p-2 pl-3">
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-full"
									style:background-color={part.color}
									aria-hidden="true"
								></span>
								<span class="min-w-0 truncate">{part.label}</span>
							</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="tabular-nums">{part.value}</span>
								<Button variant="ghost" size="sm" class="h-10" onclick={part.run}>
									{part.action}
								</Button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if car && onOnlyCar}
				<Button variant="outline" class="h-10 w-full" onclick={() => onOnlyCar(car.id)}>
					<Car class="mr-2 h-4 w-4" aria-hidden="true" />
					Show only {car.name}
				</Button>
			{/if}
		</div>

		{#if expensesHref}
			<Sheet.Footer class="pb-[max(1rem,env(safe-area-inset-bottom))]">
				{#if expensesNote}
					<p id="drill-expenses-note" class="text-xs text-muted-foreground">{expensesNote}</p>
				{/if}
				<Button
					aria-describedby={expensesNote ? 'drill-expenses-note' : undefined}
					size="lg"
					class="w-full"
					href={`${resolve(routes.expenses)}${expensesHref}`}
				>
					Open in Expenses
					<ArrowRight class="ml-2 h-4 w-4" aria-hidden="true" />
				</Button>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>
