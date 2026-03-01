<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Calculator,
		ChevronDown,
		Calendar,
		TrendingDown,
		DollarSign,
		LoaderCircle
	} from 'lucide-svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { calculateExtraPaymentImpact } from '$lib/utils/financing-calculations';
	import { debounce } from '$lib/utils/memoize';
	import type { VehicleFinancing } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
	}

	let { financing }: Props = $props();

	// State for collapsible and input
	let isOpen = $state(false);
	let extraPaymentInput = $state('');
	let debouncedExtraPaymentAmount = $state(0);

	// Parse the input value as a number
	let extraPaymentAmount = $derived(parseFloat(extraPaymentInput) || 0);

	// Debounced update function (300ms delay)
	const updateDebouncedAmount = debounce((amount: number) => {
		debouncedExtraPaymentAmount = amount;
	}, 300);

	// Update debounced amount when input changes
	$effect(() => {
		updateDebouncedAmount(extraPaymentAmount);
	});

	// Calculate the impact of extra payment with error handling (using debounced amount)
	let impact = $derived.by(() => {
		try {
			if (debouncedExtraPaymentAmount <= 0) return null;
			return calculateExtraPaymentImpact(financing, debouncedExtraPaymentAmount);
		} catch (error) {
			console.error('Error calculating extra payment impact:', error);
			return null;
		}
	});

	// Check if calculation is valid
	let hasCalculationError = $derived.by(() => {
		if (!debouncedExtraPaymentAmount || debouncedExtraPaymentAmount <= 0) return false;
		if (!impact) return true;
		return impact.monthsSaved === 0 && impact.interestSaved === 0;
	});

	// Show loading state while debouncing
	let isCalculating = $derived(
		extraPaymentAmount > 0 && extraPaymentAmount !== debouncedExtraPaymentAmount
	);

	// Only show for loans (not leases)
	let shouldRender = $derived(financing.financingType === 'loan');

	// Format months saved as a readable string
	function formatMonthsSaved(months: number): string {
		if (months === 0) return '0 months';
		const years = Math.floor(months / 12);
		const remainingMonths = months % 12;

		if (years === 0) {
			return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
		}
		if (remainingMonths === 0) {
			return `${years} year${years !== 1 ? 's' : ''}`;
		}
		return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
	}
</script>

{#if shouldRender}
	<Collapsible bind:open={isOpen}>
		<Card>
			<CardHeader class="p-4 sm:p-6">
				<CollapsibleTrigger
					class="flex w-full items-center justify-between hover:opacity-80 touch-manipulation"
					aria-expanded={isOpen}
					aria-controls="payment-calculator-content"
					aria-label="Payment calculator, {isOpen ? 'expanded' : 'collapsed'}"
				>
					<div class="flex items-center gap-2">
						<div class="rounded-full bg-chart-3/10 p-2" aria-hidden="true">
							<Calculator class="h-4 w-4 sm:h-5 sm:w-5 text-chart-3" />
						</div>
						<CardTitle class="text-base sm:text-lg">Payment Calculator</CardTitle>
					</div>
					<ChevronDown
						class="h-5 w-5 text-muted-foreground transition-transform duration-200 flex-shrink-0 {isOpen
							? 'rotate-180'
							: ''}"
						aria-hidden="true"
					/>
				</CollapsibleTrigger>
			</CardHeader>

			<CollapsibleContent id="payment-calculator-content">
				<CardContent class="space-y-4 sm:space-y-6 p-4 sm:p-6">
					<!-- Input Section -->
					<div class="space-y-2">
						<Label for="extra-payment" class="text-sm sm:text-base">Extra Payment Amount</Label>
						<div class="relative">
							<DollarSign
								class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden="true"
							/>
							<Input
								id="extra-payment"
								type="number"
								min="0"
								step="50"
								placeholder="Enter extra payment amount"
								bind:value={extraPaymentInput}
								class="pl-9 h-11 sm:h-10 text-base"
								aria-describedby="extra-payment-description"
								aria-label="Extra payment amount in dollars"
							/>
						</div>
						<p class="text-xs sm:text-sm text-muted-foreground" id="extra-payment-description">
							Calculate the impact of making extra payments on your loan
						</p>
					</div>

					<!-- Results Section -->
					{#if isCalculating}
						<div class="space-y-4" role="status" aria-live="polite">
							<div class="h-px bg-border"></div>
							<div class="flex items-center justify-center py-8">
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />
									<span>Calculating...</span>
								</div>
							</div>
						</div>
					{:else if impact && debouncedExtraPaymentAmount > 0}
						<div
							class="space-y-4"
							role="region"
							aria-live="polite"
							aria-label="Calculation results"
						>
							<div class="h-px bg-border"></div>

							<div
								class="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3"
								role="list"
								aria-label="Extra payment impact"
							>
								<!-- New Payoff Date -->
								<Card class="border-chart-2/20 bg-chart-2/5" role="listitem">
									<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
										<div class="space-y-2">
											<div
												class="flex items-center gap-2 text-xs sm:text-sm font-medium text-chart-2"
											>
												<Calendar class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
												<span id="new-payoff-label">New Payoff Date</span>
											</div>
											<p
												class="text-base sm:text-lg font-bold text-foreground break-words"
												aria-labelledby="new-payoff-label"
											>
												{formatDate(impact.newPayoffDate)}
											</p>
										</div>
									</CardContent>
								</Card>

								<!-- Time Saved -->
								<Card class="border-chart-3/20 bg-chart-3/5" role="listitem">
									<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
										<div class="space-y-2">
											<div
												class="flex items-center gap-2 text-xs sm:text-sm font-medium text-chart-3"
											>
												<TrendingDown class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
												<span id="time-saved-label">Time Saved</span>
											</div>
											<p
												class="text-base sm:text-lg font-bold text-foreground"
												aria-labelledby="time-saved-label"
											>
												{formatMonthsSaved(impact.monthsSaved)}
											</p>
										</div>
									</CardContent>
								</Card>

								<!-- Interest Saved -->
								<Card class="border-chart-4/20 bg-chart-4/5" role="listitem">
									<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
										<div class="space-y-2">
											<div
												class="flex items-center gap-2 text-xs sm:text-sm font-medium text-chart-4"
											>
												<DollarSign class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
												<span id="interest-saved-label">Interest Saved</span>
											</div>
											<p
												class="text-base sm:text-lg font-bold text-foreground"
												aria-labelledby="interest-saved-label"
											>
												{formatCurrency(impact.interestSaved)}
											</p>
										</div>
									</CardContent>
								</Card>
							</div>

							<!-- Summary Message -->
							{#if impact.monthsSaved > 0}
								<div class="rounded-lg bg-muted p-3 sm:p-4" role="status" aria-live="polite">
									<p class="text-xs sm:text-sm text-muted-foreground">
										By paying an extra <strong class="text-foreground"
											>{formatCurrency(debouncedExtraPaymentAmount)}</strong
										>
										per payment, you'll pay off your loan
										<strong class="text-foreground">{formatMonthsSaved(impact.monthsSaved)}</strong>
										earlier and save
										<strong class="text-foreground">{formatCurrency(impact.interestSaved)}</strong> in
										interest.
									</p>
								</div>
							{/if}
						</div>
					{:else if extraPaymentInput && debouncedExtraPaymentAmount <= 0}
						<div class="rounded-lg border border-chart-5/20 bg-chart-5/5 p-3 sm:p-4" role="alert">
							<p class="text-xs sm:text-sm text-chart-5">
								Please enter a valid extra payment amount greater than $0.
							</p>
						</div>
					{:else if hasCalculationError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 p-3 sm:p-4"
							role="alert"
						>
							<p class="text-xs sm:text-sm text-destructive">
								Unable to calculate the impact of extra payments. Please check your financing
								details.
							</p>
						</div>
					{/if}
				</CardContent>
			</CollapsibleContent>
		</Card>
	</Collapsible>
{/if}
