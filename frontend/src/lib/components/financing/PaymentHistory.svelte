<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Badge } from '$lib/components/ui/badge';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { Receipt, TrendingDown, DollarSign } from 'lucide-svelte';
	import type { VehicleFinancingPayment, VehicleFinancing } from '$lib/types';

	interface Props {
		payments: VehicleFinancingPayment[];
		financing: VehicleFinancing;
	}

	let { payments, financing }: Props = $props();

	// Sort payments with most recent first
	let sortedPayments = $derived(
		[...payments].sort(
			(a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()
		)
	);

	// Virtual scrolling configuration
	const VIRTUAL_SCROLL_THRESHOLD = 100;
	const ITEM_HEIGHT = 180; // Approximate height of each payment card in pixels
	const BUFFER_SIZE = 5; // Number of items to render above and below visible area

	// Virtual scrolling state
	let scrollTop = $state(0);
	let containerHeight = $state(500); // Default height

	// Calculate visible range for virtual scrolling
	let visibleRange = $derived.by(() => {
		if (sortedPayments.length <= VIRTUAL_SCROLL_THRESHOLD) {
			// Don't use virtual scrolling for small lists
			return { start: 0, end: sortedPayments.length, useVirtual: false };
		}

		const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
		const endIndex = Math.min(
			sortedPayments.length,
			Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_SIZE
		);

		return { start: startIndex, end: endIndex, useVirtual: true };
	});

	// Get visible payments
	let visiblePayments = $derived(
		visibleRange.useVirtual
			? sortedPayments.slice(visibleRange.start, visibleRange.end)
			: sortedPayments
	);

	// Calculate total height and offset for virtual scrolling
	let totalHeight = $derived(sortedPayments.length * ITEM_HEIGHT);
	let offsetY = $derived(visibleRange.start * ITEM_HEIGHT);

	// Handle scroll event
	function handleScroll(event: Event) {
		const target = event.target as HTMLElement;
		scrollTop = target.scrollTop;
	}

	// Helper function to get badge variant based on payment type
	function getPaymentTypeBadge(paymentType: string): {
		variant: 'default' | 'secondary' | 'outline';
		label: string;
	} {
		switch (paymentType) {
			case 'extra':
				return { variant: 'default', label: 'Extra Payment' };
			case 'custom-split':
				return { variant: 'secondary', label: 'Custom' };
			default:
				return { variant: 'outline', label: 'Standard' };
		}
	}
</script>

{#if sortedPayments.length === 0}
	<!-- Empty State -->
	<Card>
		<CardContent
			class="flex flex-col items-center justify-center py-8 sm:py-12 p-4 sm:p-6"
			role="status"
		>
			<div class="rounded-full bg-muted p-3 sm:p-4 mb-3 sm:mb-4" aria-hidden="true">
				<Receipt class="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
			</div>
			<h3 class="text-base sm:text-lg font-semibold mb-2">No Payment History</h3>
			<p class="text-xs sm:text-sm text-muted-foreground text-center mb-4">
				Start recording your payments to track your financing progress.
			</p>
		</CardContent>
	</Card>
{:else}
	<!-- Payment History Timeline -->
	<Card>
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="mb-4">
				<h3 class="text-base sm:text-lg font-semibold" id="payment-history-heading">
					Payment History
				</h3>
				<p class="text-xs sm:text-sm text-muted-foreground" aria-live="polite">
					{sortedPayments.length} payment{sortedPayments.length !== 1 ? 's' : ''} recorded
					{#if visibleRange.useVirtual}
						<span class="text-xs text-muted-foreground/70">(optimized view for large history)</span>
					{/if}
				</p>
			</div>

			{#if visibleRange.useVirtual}
				<!-- Virtual scrolling for large lists -->
				<div
					class="h-[400px] sm:h-[500px] overflow-y-auto pr-2 sm:pr-4"
					onscroll={handleScroll}
					aria-labelledby="payment-history-heading"
					bind:clientHeight={containerHeight}
				>
					<div style="height: {totalHeight}px; position: relative;">
						<div
							style="transform: translateY({offsetY}px);"
							class="space-y-3 sm:space-y-4"
							role="list"
							aria-label="Payment history timeline"
						>
							{#each visiblePayments as payment, index (payment.id)}
								{@const actualIndex = visibleRange.start + index}
								{@const badge = getPaymentTypeBadge(payment.paymentType)}
								{@const isExtraPayment = payment.paymentType === 'extra'}

								<div class="relative" role="listitem">
									<!-- Timeline connector (not for last item) - hidden on mobile -->
									{#if actualIndex < sortedPayments.length - 1}
										<div
											class="hidden sm:block absolute left-6 top-16 bottom-0 w-0.5 bg-border translate-y-2"
											aria-hidden="true"
										></div>
									{/if}

									<!-- Payment Card -->
									<Card
										class="relative {isExtraPayment
											? 'border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20'
											: ''}"
										aria-label="Payment {payment.paymentNumber} on {formatDate(
											new Date(payment.paymentDate)
										)}"
									>
										<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
											<div class="flex items-start gap-3 sm:gap-4">
												<!-- Payment Number Badge -->
												<div
													class="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm {isExtraPayment
														? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
														: 'bg-primary/10 text-primary'}"
													aria-label="Payment number {payment.paymentNumber}"
												>
													#{payment.paymentNumber}
												</div>

												<!-- Payment Details -->
												<div class="flex-1 min-w-0">
													<!-- Header Row -->
													<div class="flex items-start justify-between gap-2 mb-2">
														<div class="min-w-0">
															<div class="flex flex-wrap items-center gap-2 mb-1">
																<time
																	class="text-xs sm:text-sm font-medium text-muted-foreground"
																	datetime={new Date(payment.paymentDate).toISOString()}
																>
																	{formatDate(new Date(payment.paymentDate))}
																</time>
																<Badge variant={badge.variant} class="text-xs">{badge.label}</Badge>
															</div>
															<div
																class="text-xl sm:text-2xl font-bold break-words"
																aria-label="Payment amount"
															>
																{formatCurrency(payment.paymentAmount)}
															</div>
														</div>

														{#if isExtraPayment}
															<div
																class="rounded-full bg-green-100 dark:bg-green-900/40 p-1.5 sm:p-2 flex-shrink-0"
																aria-label="Extra payment indicator"
															>
																<TrendingDown
																	class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 dark:text-green-400"
																	aria-hidden="true"
																/>
															</div>
														{/if}
													</div>

													<!-- Payment Breakdown -->
													{#if financing.financingType === 'loan' && financing.apr && financing.apr > 0}
														<div
															class="grid grid-cols-2 gap-3 sm:gap-4 mb-3"
															role="group"
															aria-label="Payment breakdown"
														>
															<div class="space-y-1">
																<div
																	class="flex items-center gap-1.5 text-xs text-muted-foreground"
																>
																	<DollarSign class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
																	<span id="principal-{payment.id}">Principal</span>
																</div>
																<div
																	class="text-xs sm:text-sm font-semibold"
																	aria-labelledby="principal-{payment.id}"
																>
																	{formatCurrency(payment.principalAmount)}
																</div>
															</div>
															<div class="space-y-1">
																<div
																	class="flex items-center gap-1.5 text-xs text-muted-foreground"
																>
																	<DollarSign class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
																	<span id="interest-{payment.id}">Interest</span>
																</div>
																<div
																	class="text-xs sm:text-sm font-semibold"
																	aria-labelledby="interest-{payment.id}"
																>
																	{formatCurrency(payment.interestAmount)}
																</div>
															</div>
														</div>
													{/if}

													<!-- Remaining Balance -->
													<div
														class="pt-2 sm:pt-3 border-t border-border flex items-center justify-between text-xs sm:text-sm"
													>
														<span class="text-muted-foreground" id="remaining-balance-{payment.id}"
															>Remaining Balance</span
														>
														<span
															class="font-semibold"
															aria-labelledby="remaining-balance-{payment.id}"
															>{formatCurrency(payment.remainingBalance)}</span
														>
													</div>
												</div>
											</div>
										</CardContent>
									</Card>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{:else}
				<!-- Standard scrolling for smaller lists -->
				<ScrollArea
					class="h-[400px] sm:h-[500px] pr-2 sm:pr-4"
					aria-labelledby="payment-history-heading"
				>
					<div class="space-y-3 sm:space-y-4" role="list" aria-label="Payment history timeline">
						{#each visiblePayments as payment, index (payment.id)}
							{@const badge = getPaymentTypeBadge(payment.paymentType)}
							{@const isExtraPayment = payment.paymentType === 'extra'}

							<div class="relative" role="listitem">
								<!-- Timeline connector (not for last item) - hidden on mobile -->
								{#if index < sortedPayments.length - 1}
									<div
										class="hidden sm:block absolute left-6 top-16 bottom-0 w-0.5 bg-border translate-y-2"
										aria-hidden="true"
									></div>
								{/if}

								<!-- Payment Card -->
								<Card
									class="relative {isExtraPayment
										? 'border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20'
										: ''}"
									aria-label="Payment {payment.paymentNumber} on {formatDate(
										new Date(payment.paymentDate)
									)}"
								>
									<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
										<div class="flex items-start gap-3 sm:gap-4">
											<!-- Payment Number Badge -->
											<div
												class="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm {isExtraPayment
													? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
													: 'bg-primary/10 text-primary'}"
												aria-label="Payment number {payment.paymentNumber}"
											>
												#{payment.paymentNumber}
											</div>

											<!-- Payment Details -->
											<div class="flex-1 min-w-0">
												<!-- Header Row -->
												<div class="flex items-start justify-between gap-2 mb-2">
													<div class="min-w-0">
														<div class="flex flex-wrap items-center gap-2 mb-1">
															<time
																class="text-xs sm:text-sm font-medium text-muted-foreground"
																datetime={new Date(payment.paymentDate).toISOString()}
															>
																{formatDate(new Date(payment.paymentDate))}
															</time>
															<Badge variant={badge.variant} class="text-xs">{badge.label}</Badge>
														</div>
														<div
															class="text-xl sm:text-2xl font-bold break-words"
															aria-label="Payment amount"
														>
															{formatCurrency(payment.paymentAmount)}
														</div>
													</div>

													{#if isExtraPayment}
														<div
															class="rounded-full bg-green-100 dark:bg-green-900/40 p-1.5 sm:p-2 flex-shrink-0"
															aria-label="Extra payment indicator"
														>
															<TrendingDown
																class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 dark:text-green-400"
																aria-hidden="true"
															/>
														</div>
													{/if}
												</div>

												<!-- Payment Breakdown -->
												{#if financing.financingType === 'loan' && financing.apr && financing.apr > 0}
													<div
														class="grid grid-cols-2 gap-3 sm:gap-4 mb-3"
														role="group"
														aria-label="Payment breakdown"
													>
														<div class="space-y-1">
															<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
																<DollarSign class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
																<span id="principal-{payment.id}">Principal</span>
															</div>
															<div
																class="text-xs sm:text-sm font-semibold"
																aria-labelledby="principal-{payment.id}"
															>
																{formatCurrency(payment.principalAmount)}
															</div>
														</div>
														<div class="space-y-1">
															<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
																<DollarSign class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
																<span id="interest-{payment.id}">Interest</span>
															</div>
															<div
																class="text-xs sm:text-sm font-semibold"
																aria-labelledby="interest-{payment.id}"
															>
																{formatCurrency(payment.interestAmount)}
															</div>
														</div>
													</div>
												{/if}

												<!-- Remaining Balance -->
												<div
													class="pt-2 sm:pt-3 border-t border-border flex items-center justify-between text-xs sm:text-sm"
												>
													<span class="text-muted-foreground" id="remaining-balance-{payment.id}"
														>Remaining Balance</span
													>
													<span
														class="font-semibold"
														aria-labelledby="remaining-balance-{payment.id}"
														>{formatCurrency(payment.remainingBalance)}</span
													>
												</div>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>
						{/each}
					</div>
				</ScrollArea>
			{/if}
		</CardContent>
	</Card>
{/if}
