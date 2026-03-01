<script lang="ts">
	import type { VehicleFinancing } from '$lib/types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { calculateMinimumPayment } from '$lib/utils/financing-calculations';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { debounce } from '$lib/utils/memoize';
	import {
		computePlannerState,
		canSave as canSaveCheck,
		buildSummary,
		type PlannerState
	} from '$lib/utils/payment-planner';
	import { Button } from '$lib/components/ui/button';
	import {
		Calculator,
		Calendar,
		TrendingDown,
		DollarSign,
		ArrowUp,
		ArrowDown,
		Save,
		LoaderCircle
	} from 'lucide-svelte';

	interface Props {
		financing: VehicleFinancing;
		open: boolean;
		onPaymentAmountSaved: (_newAmount: number) => Promise<void>;
	}

	let { financing, open = $bindable(false), onPaymentAmountSaved }: Props = $props();

	async function handleSave() {
		isSaving = true;
		saveError = '';
		try {
			await onPaymentAmountSaved(inputAmount);
			savedAmount = inputAmount;
			open = false;
		} catch (err: unknown) {
			const message =
				err instanceof Error ? err.message : 'Failed to save payment amount. Please try again.';
			saveError = message;
			if (import.meta.env.DEV) {
				console.error('Payment save failed:', err);
			}
		} finally {
			isSaving = false;
		}
	}

	let inputValue = $state(financing.paymentAmount.toFixed(2));
	let savedAmount = $state(financing.paymentAmount);
	let isSaving = $state(false);
	let saveError = $state('');

	let inputAmount = $derived(parseFloat(inputValue) || 0);
	let minimumPayment = $derived(calculateMinimumPayment(financing));

	// Debounced input for impact calculations
	let debouncedInput = $state(financing.paymentAmount);
	const updateDebounced = debounce((val: number) => {
		debouncedInput = val;
	}, 300);

	$effect(() => {
		const current = inputAmount;
		updateDebounced(current);
	});

	// Reset state when dialog opens
	$effect(() => {
		if (open) {
			inputValue = financing.paymentAmount.toFixed(2);
			savedAmount = financing.paymentAmount;
			saveError = '';
			debouncedInput = financing.paymentAmount;
		}
	});

	let plannerState: PlannerState = $derived.by(() =>
		computePlannerState(financing, debouncedInput, minimumPayment ?? 0, savedAmount)
	);

	let saveEnabled = $derived(canSaveCheck(inputAmount, minimumPayment ?? 0, savedAmount, isSaving));
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Calculator class="h-5 w-5 text-muted-foreground" />
				Payment Planner
			</Dialog.Title>
			<Dialog.Description>
				Adjust your monthly payment and see the impact on your loan.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Payment Input -->
			<div class="space-y-2">
				<Label for="payment-input">Monthly Payment</Label>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
					<Input
						id="payment-input"
						type="number"
						step="0.01"
						min="0"
						class="pl-7"
						bind:value={inputValue}
					/>
				</div>
				<p class="text-xs text-muted-foreground">
					Min: {formatCurrency(minimumPayment ?? 0)} · Current: {formatCurrency(savedAmount)}
				</p>
			</div>

			<!-- Validation / State Messages -->
			{#if plannerState.state === 'below-minimum'}
				<div
					class="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
				>
					{plannerState.error}
				</div>
			{:else if plannerState.state === 'at-minimum'}
				<div class="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
					{plannerState.message}
				</div>
			{/if}

			<!-- Impact cards -->
			{#if plannerState.state === 'normal' || plannerState.state === 'with-delta'}
				{@const impact = plannerState.primaryImpact}
				{@const delta = plannerState.state === 'with-delta' ? plannerState.secondaryDelta : null}
				<div class="grid grid-cols-3 gap-3">
					<!-- Payoff Date -->
					<div class="rounded-lg border bg-card p-3 text-center">
						<Calendar class="mx-auto mb-1 h-4 w-4 text-chart-1" />
						<p class="text-sm font-semibold text-foreground">
							{formatDate(impact.newPayoffDate)}
						</p>
						<p class="text-xs text-muted-foreground">Payoff Date</p>
					</div>

					<!-- Time Saved -->
					<div class="rounded-lg border bg-card p-3 text-center">
						<TrendingDown class="mx-auto mb-1 h-4 w-4 text-chart-2" />
						<p class="text-sm font-semibold text-foreground">
							{impact.monthsSaved}
							{impact.monthsSaved === 1 ? 'mo' : 'mos'}
						</p>
						<p class="text-xs text-muted-foreground">Time Saved</p>
						{#if delta}
							{@const monthsAbs = Math.abs(delta.monthsDelta)}
							<p
								class="mt-1 text-xs {delta.direction === 'better'
									? 'text-chart-2'
									: 'text-destructive'}"
							>
								{#if delta.direction === 'better'}
									<ArrowUp class="inline h-3 w-3" />
									+{monthsAbs} mo vs current
								{:else}
									<ArrowDown class="inline h-3 w-3" />
									-{monthsAbs} mo vs current
								{/if}
							</p>
						{/if}
					</div>

					<!-- Interest Saved -->
					<div class="rounded-lg border bg-card p-3 text-center">
						<DollarSign class="mx-auto mb-1 h-4 w-4 text-chart-3" />
						<p class="text-sm font-semibold text-foreground">
							{formatCurrency(impact.interestSaved)}
						</p>
						<p class="text-xs text-muted-foreground">Interest Saved</p>
						{#if delta}
							{@const interestAbs = Math.abs(delta.interestDelta)}
							<p
								class="mt-1 text-xs {delta.direction === 'better'
									? 'text-chart-2'
									: 'text-destructive'}"
							>
								{#if delta.direction === 'better'}
									<ArrowUp class="inline h-3 w-3" />
									+{formatCurrency(interestAbs)} vs current
								{:else}
									<ArrowDown class="inline h-3 w-3" />
									-{formatCurrency(interestAbs)} vs current
								{/if}
							</p>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Summary sentence -->
			{#if plannerState.state === 'normal' || plannerState.state === 'with-delta'}
				{@const impact = plannerState.primaryImpact}
				{@const delta = plannerState.state === 'with-delta' ? plannerState.secondaryDelta : null}
				<div class="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
					{buildSummary(debouncedInput, savedAmount, minimumPayment ?? 0, impact, delta)}
				</div>
			{/if}

			<!-- Save button and error display -->
			<div class="space-y-2">
				<Button class="w-full" disabled={!saveEnabled} onclick={handleSave}>
					{#if isSaving}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Saving…
					{:else}
						<Save class="mr-2 h-4 w-4" />
						Save
					{/if}
				</Button>
				{#if saveError}
					<p class="text-sm text-destructive">{saveError}</p>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
