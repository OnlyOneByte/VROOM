<script lang="ts">
	import { DollarSign, Calculator } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { Vehicle, FinancingFormErrors, FinancingPaymentConfig } from '$lib/types';

	interface Props {
		ownershipType: 'own' | 'lease' | 'finance';
		financingForm: {
			financingType: 'loan' | 'lease' | 'own';
			provider: string;
			originalAmount: number;
			apr: number;
			termMonths: number;
			startDate: string | undefined;
			paymentAmount: number;
			frequency: FinancingPaymentConfig['frequency'];
			dayOfMonth: number;
			residualValue: number | undefined;
			mileageLimit: number | undefined;
			excessMileageFee: number | undefined;
		};
		errors: FinancingFormErrors;
		isEditMode: boolean;
		vehicle: Vehicle | null;
		amortizationPreview: {
			monthlyPayment: number;
			totalInterest: number;
			totalPayments: number;
			payoffDate: Date;
		} | null;
	}

	let {
		ownershipType = $bindable(),
		financingForm = $bindable(),
		errors,
		isEditMode,
		vehicle,
		amortizationPreview
	}: Props = $props();

	function formatPayoffDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short'
		});
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<DollarSign class="h-5 w-5 text-primary" />
			<CardTitle>Financing Information</CardTitle>
		</div>
		<CardDescription>
			{ownershipType === 'own'
				? 'This vehicle is owned outright'
				: ownershipType === 'lease'
					? 'Lease details and payment information'
					: 'Loan details and payment information'}
		</CardDescription>
	</CardHeader>
	<CardContent>
		<!-- Ownership Type Selector -->
		<div class="mb-6">
			<Label class="mb-3 block">How do you own this vehicle? *</Label>
			<div class="grid grid-cols-3 gap-3">
				<Button
					type="button"
					variant={ownershipType === 'own' ? 'default' : 'outline'}
					onclick={() => (ownershipType = 'own')}
					class="h-auto py-3"
				>
					Own
				</Button>
				<Button
					type="button"
					variant={ownershipType === 'lease' ? 'default' : 'outline'}
					onclick={() => (ownershipType = 'lease')}
					class="h-auto py-3"
				>
					Lease
				</Button>
				<Button
					type="button"
					variant={ownershipType === 'finance' ? 'default' : 'outline'}
					onclick={() => (ownershipType = 'finance')}
					class="h-auto py-3"
				>
					Finance
				</Button>
			</div>
		</div>

		{#if ownershipType !== 'own'}
			<div class="space-y-6">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div class="space-y-2">
						<Label for="provider">
							{ownershipType === 'finance' ? 'Lender' : 'Leasing Company'} *
						</Label>
						<Input
							id="provider"
							type="text"
							placeholder="e.g., Chase Bank, Toyota Financial"
							bind:value={financingForm.provider}
							aria-invalid={!!errors['provider']}
							required
						/>
						{#if errors['provider']}
							<FormFieldError id="provider-error">{errors['provider']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="originalAmount">
							{isEditMode ? 'Original ' : ''}{ownershipType === 'lease'
								? 'Total Lease Obligation'
								: 'Loan Amount'} *
						</Label>
						<Input
							id="originalAmount"
							type="number"
							min="0"
							step="0.01"
							placeholder="0.00"
							bind:value={financingForm.originalAmount}
							aria-invalid={!!errors['originalAmount']}
							required
						/>
						{#if errors['originalAmount']}
							<FormFieldError id="originalAmount-error">{errors['originalAmount']}</FormFieldError>
						{/if}
					</div>

					{#if ownershipType === 'finance'}
						<div class="space-y-2">
							<Label for="apr">APR (%) *</Label>
							<Input
								id="apr"
								type="number"
								min="0"
								max="50"
								step="0.01"
								placeholder="e.g., 4.5"
								bind:value={financingForm.apr}
								aria-invalid={!!errors['apr']}
								required
							/>
							{#if errors['apr']}
								<FormFieldError id="apr-error">{errors['apr']}</FormFieldError>
							{/if}
						</div>
					{/if}

					<div class="space-y-2">
						<Label for="termMonths">Term (Months) *</Label>
						<Select.Root
							type="single"
							value={String(financingForm.termMonths)}
							onValueChange={v => {
								if (v) financingForm.termMonths = Number(v);
							}}
						>
							<Select.Trigger id="termMonths" class="w-full">
								{financingForm.termMonths} months ({Math.floor(financingForm.termMonths / 12)} years)
							</Select.Trigger>
							<Select.Content>
								{#each [24, 36, 48, 60, 72, 84] as months (months)}
									<Select.Item value={String(months)} label="{months} months ({months / 12} years)">
										{months} months ({months / 12} years)
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						{#if errors['termMonths']}
							<FormFieldError id="termMonths-error">{errors['termMonths']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="startDate">Start Date *</Label>
						<DatePicker
							id="startDate"
							bind:value={financingForm.startDate}
							placeholder="Select start date"
						/>
						{#if errors['startDate']}
							<FormFieldError id="startDate-error">{errors['startDate']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="dayOfMonth">Payment Day of Month</Label>
						<Select.Root
							type="single"
							value={String(financingForm.dayOfMonth)}
							onValueChange={v => {
								if (v) financingForm.dayOfMonth = Number(v);
							}}
						>
							<Select.Trigger id="dayOfMonth" class="w-full">
								{financingForm.dayOfMonth}
							</Select.Trigger>
							<Select.Content>
								{#each Array(28) as _, i (i)}
									<Select.Item value={String(i + 1)} label={String(i + 1)}>{i + 1}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Monthly Payment (for leases — loans auto-calculate this) -->
					{#if ownershipType === 'lease'}
						<div class="space-y-2">
							<Label for="paymentAmount">Monthly Payment *</Label>
							<Input
								id="paymentAmount"
								type="number"
								min="0.01"
								step="0.01"
								placeholder="e.g., 350.00"
								bind:value={financingForm.paymentAmount}
								aria-invalid={!!errors['paymentAmount']}
								aria-describedby={errors['paymentAmount'] ? 'paymentAmount-error' : undefined}
								required
							/>
							{#if errors['paymentAmount']}
								<FormFieldError id="paymentAmount-error">{errors['paymentAmount']}</FormFieldError>
							{/if}
						</div>
					{/if}

					{#if ownershipType === 'lease'}
						<div class="space-y-2">
							<Label for="residualValue">Residual Value (Buyout Price)</Label>
							<Input
								id="residualValue"
								type="number"
								min="0"
								step="0.01"
								placeholder="0.00"
								bind:value={financingForm.residualValue}
							/>
						</div>
						<div class="space-y-2">
							<Label for="mileageLimit">Annual Mileage Limit</Label>
							<Input
								id="mileageLimit"
								type="number"
								min="0"
								placeholder="e.g., 12000"
								bind:value={financingForm.mileageLimit}
							/>
						</div>
						<div class="space-y-2">
							<Label for="excessMileageFee">Excess Mileage Fee (per mile)</Label>
							<Input
								id="excessMileageFee"
								type="number"
								min="0"
								step="0.01"
								placeholder="e.g., 0.25"
								bind:value={financingForm.excessMileageFee}
							/>
						</div>
					{/if}
				</div>

				<!-- Current Balance (Edit Mode) -->
				{#if isEditMode && vehicle?.financing?.currentBalance !== undefined}
					<Card class="bg-muted/50">
						<CardHeader>
							<CardTitle class="text-base">Current Status</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
								<div>
									<p class="text-muted-foreground">Current Balance</p>
									<p class="font-semibold text-lg">
										{formatCurrency(vehicle.financing.currentBalance)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground">Original Amount</p>
									<p class="font-semibold text-lg">
										{formatCurrency(vehicle.financing.originalAmount)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground">Amount Paid</p>
									<p class="font-semibold text-lg">
										{formatCurrency(
											vehicle.financing.originalAmount - vehicle.financing.currentBalance
										)}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}

				<!-- Amortization Preview -->
				{#if amortizationPreview && ownershipType === 'finance'}
					<Card class="border-primary/20 bg-primary/5">
						<CardHeader>
							<div class="flex items-center gap-2">
								<Calculator class="h-4 w-4 text-primary" />
								<CardTitle class="text-base">
									{isEditMode ? 'Updated ' : ''}Loan Calculation Preview
								</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
								<div>
									<p class="text-muted-foreground font-medium">Monthly Payment</p>
									<p class="font-semibold text-lg">
										{formatCurrency(amortizationPreview.monthlyPayment)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Total Interest</p>
									<p class="font-semibold">{formatCurrency(amortizationPreview.totalInterest)}</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Total Payments</p>
									<p class="font-semibold">{formatCurrency(amortizationPreview.totalPayments)}</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Payoff Date</p>
									<p class="font-semibold">
										{formatPayoffDate(amortizationPreview.payoffDate)}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}
			</div>
		{:else}
			<p class="text-muted-foreground text-center py-8">
				This vehicle is owned outright with no financing or lease.
			</p>
		{/if}
	</CardContent>
</Card>
