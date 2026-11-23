<script lang="ts">
	import { onMount } from 'svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import type { VehicleFinancing } from '#lib/types/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import {
		calculateMinimumPayment,
		type NextPaymentBasis
	} from '#lib/utils/financing-calculations.ts';
	import {
		amountStep,
		formatCurrency,
		formatDate,
		getCurrencySymbol,
		toAmountInput
	} from '#lib/utils/formatters.ts';
	import { debounce } from '#lib/utils/memoize.ts';
	import {
		computePlannerState,
		canSave as canSaveCheck,
		buildSummary,
		type PlannerState
	} from '#lib/utils/payment-planner.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Calculator,
		Calendar,
		TrendingDown,
		DollarSign,
		ArrowUp,
		ArrowDown,
		Save,
		LoaderCircle
	} from '@lucide/svelte';

	interface Props {
		financing: VehicleFinancing;
		open: boolean;
		onPaymentAmountSaved: (_newAmount: number) => Promise<void>;
		nextPayment?: NextPaymentBasis;
	}

	let {
		financing,
		open = $bindable(false),
		onPaymentAmountSaved,
		nextPayment = {}
	}: Props = $props();

	const currencySymbol = $derived(getCurrencySymbol());

	async function handleSave() {
		isSaving = true;
		saveError = '';
		try {
			await onPaymentAmountSaved(inputAmount);
			savedAmount = inputAmount;
			open = false;
		} catch (err: unknown) {
			saveError = `Couldn't save the payment amount. ${userFacingErrorMessage(err)}`;
			if (import.meta.env.DEV) {
				console.error('Payment save failed:', err);
			}
		} finally {
			isSaving = false;
		}
	}

	let inputValue = $state('');
	let savedAmount = $state(0);
	let isSaving = $state(false);
	let saveError = $state('');

	onMount(() => trackPendingSave(() => isSaving));

	let inputAmount = $derived(parseFloat(inputValue) || 0);
	let minimumPayment = $derived(calculateMinimumPayment(financing));

	let debouncedInput = $state(0);
	const updateDebounced = debounce((val: number) => {
		debouncedInput = val;
	}, 300);

	$effect(() => {
		const current = inputAmount;
		updateDebounced(current);
	});

	$effect(() => {
		if (open) {
			inputValue = toAmountInput(financing.paymentAmount);
			savedAmount = financing.paymentAmount;
			saveError = '';
			debouncedInput = financing.paymentAmount;
		}
	});

	let plannerState: PlannerState = $derived.by(() =>
		computePlannerState(financing, debouncedInput, minimumPayment ?? 0, savedAmount, nextPayment)
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
			<div class="space-y-2">
				<Label for="payment-input">Monthly Payment ({currencySymbol})</Label>
				<Input
					id="payment-input"
					type="number"
					step={amountStep()}
					min="0"
					bind:value={inputValue}
				/>
				<p class="text-xs text-muted-foreground">
					Min: {formatCurrency(minimumPayment ?? 0)} · Current: {formatCurrency(savedAmount)}
				</p>
			</div>

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

			{#if plannerState.state === 'normal' || plannerState.state === 'with-delta'}
				{@const impact = plannerState.primaryImpact}
				{@const delta = plannerState.state === 'with-delta' ? plannerState.secondaryDelta : null}
				<div class="grid grid-cols-3 gap-3">
					<div class="rounded-lg border bg-card p-3 text-center">
						<Calendar class="mx-auto mb-1 h-4 w-4 text-chart-1" />
						<p class="text-sm font-semibold text-foreground">
							{formatDate(impact.newPayoffDate)}
						</p>
						<p class="text-xs text-muted-foreground">Payoff Date</p>
					</div>

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

			{#if plannerState.state === 'normal' || plannerState.state === 'with-delta'}
				{@const impact = plannerState.primaryImpact}
				{@const delta = plannerState.state === 'with-delta' ? plannerState.secondaryDelta : null}
				<div class="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
					{buildSummary(debouncedInput, savedAmount, minimumPayment ?? 0, impact, delta)}
				</div>
			{/if}

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
