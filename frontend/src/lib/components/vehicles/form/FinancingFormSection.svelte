<script lang="ts">
	import { Calculator } from '@lucide/svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';
	import {
		amountPlaceholder,
		amountStep,
		formatCurrency,
		formatDateWith
	} from '#lib/utils/formatters.ts';
	import type { Vehicle, FinancingFormErrors, FinancingPaymentConfig } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';

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
		distanceUnit: DistanceUnit;
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
		distanceUnit,
		amortizationPreview
	}: Props = $props();

	const distanceShort = $derived(getDistanceUnitLabel(distanceUnit, true));

	const KINDS = [
		{ value: 'finance', label: 'Loan' },
		{ value: 'lease', label: 'Lease' }
	] as const;

	let lastKind = $state<'finance' | 'lease'>(ownershipType === 'lease' ? 'lease' : 'finance');
	let financed = $derived(ownershipType !== 'own');

	function setFinanced(on: boolean) {
		if (!on && ownershipType !== 'own') lastKind = ownershipType;
		ownershipType = on ? lastKind : 'own';
	}

	function formatPayoffDate(date: Date): string {
		return formatDateWith(new Date(date), {
			year: 'numeric',
			month: 'short'
		});
	}
</script>

<Card variant="section">
	<CardHeader>
		<CardTitle level={2} class="text-base">Ownership</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="mb-6 flex items-start justify-between gap-4 border-b border-border pb-6">
			<div class="min-w-0">
				<Label for="financed" class="text-base font-semibold">This car has a loan or lease</Label>
				<p id="financed-hint" class="mt-1 text-sm text-muted-foreground">
					Adds the Finance tab and counts payments as ownership costs
				</p>
			</div>
			<Switch
				id="financed"
				checked={financed}
				onCheckedChange={setFinanced}
				aria-describedby="financed-hint"
			/>
		</div>

		{#if financed}
			<fieldset class="mb-6">
				<legend class="mb-2 text-sm font-medium">Which one?</legend>
				<div class="flex flex-wrap gap-2">
					{#each KINDS as kind (kind.value)}
						<label
							class="inline-flex h-10 cursor-pointer items-center rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold transition-colors has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
						>
							<input
								type="radio"
								name="financingKind"
								class="sr-only"
								value={kind.value}
								checked={ownershipType === kind.value}
								onchange={() => (ownershipType = kind.value)}
							/>
							{kind.label}
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}

		{#if ownershipType !== 'own'}
			<div class="space-y-6">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div class="space-y-2">
						<Label for="provider">
							{ownershipType === 'finance' ? 'Lender' : 'Leasing company'}
						</Label>
						<Input
							id="provider"
							type="text"
							placeholder="e.g., Chase Bank, Toyota Financial"
							bind:value={financingForm.provider}
							aria-invalid={!!errors['provider']}
							aria-describedby={errors['provider'] ? 'provider-error' : undefined}
							required
						/>
						{#if errors['provider']}
							<FormFieldError id="provider-error">{errors['provider']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="originalAmount">
							{ownershipType === 'lease'
								? 'Total lease obligation'
								: isEditMode
									? 'Original loan amount'
									: 'Loan amount'}
						</Label>
						<Input
							id="originalAmount"
							type="number"
							min="0"
							step={amountStep()}
							placeholder={amountPlaceholder()}
							bind:value={financingForm.originalAmount}
							aria-invalid={!!errors['originalAmount']}
							aria-describedby={errors['originalAmount'] ? 'originalAmount-error' : undefined}
							required
						/>
						{#if errors['originalAmount']}
							<FormFieldError id="originalAmount-error">{errors['originalAmount']}</FormFieldError>
						{/if}
					</div>

					{#if ownershipType === 'finance'}
						<div class="space-y-2">
							<Label for="apr">APR (%)</Label>
							<Input
								id="apr"
								type="number"
								min="0"
								max="50"
								step={0.01}
								placeholder="e.g., 4.5"
								bind:value={financingForm.apr}
								aria-invalid={!!errors['apr']}
								aria-describedby={errors['apr'] ? 'apr-error' : undefined}
								required
							/>
							{#if errors['apr']}
								<FormFieldError id="apr-error">{errors['apr']}</FormFieldError>
							{/if}
						</div>
					{/if}

					<div class="space-y-2">
						<Label for="termMonths">Term</Label>
						<Select.Root
							type="single"
							value={String(financingForm.termMonths)}
							onValueChange={v => {
								if (v) financingForm.termMonths = Number(v);
							}}
						>
							<Select.Trigger
								id="termMonths"
								class="w-full"
								aria-invalid={!!errors['termMonths']}
								aria-describedby={errors['termMonths'] ? 'termMonths-error' : undefined}
							>
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
						<Label for="startDate">Start date</Label>
						<DatePicker
							id="startDate"
							bind:value={financingForm.startDate}
							placeholder="Select start date"
							aria-invalid={!!errors['startDate']}
							aria-describedby={errors['startDate'] ? 'startDate-error' : undefined}
						/>
						{#if errors['startDate']}
							<FormFieldError id="startDate-error">{errors['startDate']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="dayOfMonth">Payment day of the month</Label>
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

					{#if ownershipType === 'lease'}
						<div class="space-y-2">
							<Label for="paymentAmount">Monthly payment</Label>
							<Input
								id="paymentAmount"
								type="number"
								min={amountStep()}
								step={amountStep()}
								placeholder={amountPlaceholder()}
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
							<Label for="residualValue">
								Residual value (buyout price) <span class="font-normal text-muted-foreground">
									(optional)
								</span>
							</Label>
							<Input
								id="residualValue"
								type="number"
								min="0"
								step={amountStep()}
								placeholder={amountPlaceholder()}
								bind:value={financingForm.residualValue}
							/>
						</div>
						<div class="space-y-2">
							<Label for="mileageLimit">
								Yearly mileage limit ({distanceShort})
								<span class="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="mileageLimit"
								type="number"
								min="0"
								placeholder={distanceUnit === 'kilometers' ? 'e.g., 20000' : 'e.g., 12000'}
								bind:value={financingForm.mileageLimit}
							/>
						</div>
						<div class="space-y-2">
							<Label for="excessMileageFee">
								Fee per extra {distanceShort}
								<span class="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="excessMileageFee"
								type="number"
								min="0"
								step={amountStep()}
								placeholder={amountPlaceholder()}
								bind:value={financingForm.excessMileageFee}
							/>
						</div>
					{/if}
				</div>

				{#if isEditMode && vehicle?.financing?.computedBalance !== undefined}
					<Card class="bg-muted/50">
						<CardHeader>
							<CardTitle class="text-base">Current status</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
								<div>
									<p class="text-muted-foreground">Current balance</p>
									<p class="font-semibold text-lg">
										{formatCurrency(vehicle.financing.computedBalance ?? 0)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground">Original amount</p>
									<p class="font-semibold text-lg">
										{formatCurrency(vehicle.financing.originalAmount)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground">Principal paid</p>
									<p class="font-semibold text-lg">
										{formatCurrency(
											Math.max(
												0,
												vehicle.financing.originalAmount - (vehicle.financing.computedBalance ?? 0)
											)
										)}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}

				{#if amortizationPreview && ownershipType === 'finance'}
					<Card class="border-primary/20 bg-primary/5">
						<CardHeader>
							<div class="flex items-center gap-2">
								<Calculator class="h-4 w-4 text-primary" />
								<CardTitle class="text-base">
									{isEditMode ? 'Updated loan calculation preview' : 'Loan calculation preview'}
								</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
								<div>
									<p class="text-muted-foreground font-medium">Monthly payment</p>
									<p class="font-semibold text-lg">
										{formatCurrency(amortizationPreview.monthlyPayment)}
									</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Total interest</p>
									<p class="font-semibold">{formatCurrency(amortizationPreview.totalInterest)}</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Total payments</p>
									<p class="font-semibold">{formatCurrency(amortizationPreview.totalPayments)}</p>
								</div>
								<div>
									<p class="text-muted-foreground font-medium">Payoff date</p>
									<p class="font-semibold">
										{formatPayoffDate(amortizationPreview.payoffDate)}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
