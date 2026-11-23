<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount } from 'svelte';
	import { addVehicleFirstTo } from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import { dateOnlyToISO, toDateInputValue } from '#lib/utils/formatters.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { ArrowLeft, Check, LoaderCircle, X, FileText } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import SplitConfigEditor from '#lib/components/expenses/split/SplitConfigEditor.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import {
		effectiveTermCost,
		enteredAmount,
		prefillFromPreviousTerm
	} from '#lib/utils/insurance.ts';
	import { amountStep, getCurrencySymbol } from '#lib/utils/formatters.ts';
	import type { InsurancePolicy, InsuranceTerm, Vehicle } from '#lib/types/index.ts';

	interface Props {
		policyId: string;
		termId?: string;
		renewFrom?: string;
		returnTo?: string;
	}

	let { policyId, termId, renewFrom, returnTo = '/insurance' }: Props = $props();

	const currencySymbol = $derived(getCurrencySymbol());

	const isEditMode = $derived(!!termId);

	let isLoading = $state(true);
	let isSubmitting = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting));
	let policy = $state<InsurancePolicy | null>(null);
	let vehicles = $state<Vehicle[]>([]);

	let startDate = $state('');
	let endDate = $state('');
	let policyNumber = $state('');
	let coverageDescription = $state('');
	let deductibleAmount = $state('');
	let coverageLimit = $state('');
	let agentName = $state('');
	let agentPhone = $state('');
	let agentEmail = $state('');
	let totalCost = $state('');
	let monthlyCost = $state('');
	let premiumFrequency = $state('');
	let paymentAmount = $state('');
	let selectedVehicleIds = $state<string[]>([]);

	let splitVehicles = $derived(
		selectedVehicleIds.flatMap(id => vehicles.find(v => v.id === id) ?? [])
	);
	let premiumTotal = $derived(effectiveTermCost({ totalCost, monthlyCost, startDate, endDate }));
	let premiumFromMonthlyCost = $derived((enteredAmount(totalCost) ?? 0) <= 0);
	let showSplitEditor = $derived(premiumTotal > 0 && selectedVehicleIds.length >= 2);

	interface FormErrors {
		startDate?: string;
		endDate?: string;
		vehicles?: string;
		deductibleAmount?: string;
		coverageLimit?: string;
		totalCost?: string;
		monthlyCost?: string;
		paymentAmount?: string;
	}
	let errors = $state<FormErrors>({});

	let pageTitle = $derived(isEditMode ? 'Edit Term' : renewFrom ? 'Renew Term' : 'Add Term');

	let loadError = $state<string | null>(null);

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		loadError = null;
		try {
			const [policyData, vehiclesData] = await Promise.all([
				insuranceApi.getPolicy(policyId),
				vehicleApi.getVehicles()
			]);
			policy = policyData;
			vehicles = vehiclesData;

			if (isEditMode && termId) {
				const term = policy.terms.find(t => t.id === termId);
				if (!term) {
					appStore.showError('That term no longer exists.');
					gotoDynamic(returnTo);
					return;
				}
				populateFromTerm(term);
				const coverage = policy.termVehicleCoverage.filter(tc => tc.termId === termId);
				selectedVehicleIds = coverage.map(tc => tc.vehicleId);
			} else if (renewFrom) {
				const prev = policy.terms.find(t => t.id === renewFrom);
				if (prev) {
					const prefill = prefillFromPreviousTerm(prev);
					populateFromTerm(prefill);
					startDate = '';
					endDate = '';
					const prevCoverage = policy.termVehicleCoverage.filter(tc => tc.termId === renewFrom);
					selectedVehicleIds = prevCoverage.map(tc => tc.vehicleId);
				}
			}
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to load data:', err);
			if (err instanceof ApiError && err.statusCode === 404) {
				appStore.showError('That policy no longer exists.');
				gotoDynamic(returnTo);
				return;
			}
			loadError = userFacingErrorMessage(err);
		} finally {
			isLoading = false;
		}
	}

	function populateFromTerm(source: InsuranceTerm | Partial<InsuranceTerm>) {
		if (source.startDate && typeof source.startDate === 'string') {
			startDate = toDateInputValue(source.startDate);
		}
		if (source.endDate && typeof source.endDate === 'string') {
			endDate = toDateInputValue(source.endDate);
		}
		policyNumber = source.policyNumber ?? '';
		coverageDescription = source.coverageDescription ?? '';
		deductibleAmount = source.deductibleAmount?.toString() ?? '';
		coverageLimit = source.coverageLimit?.toString() ?? '';
		agentName = source.agentName ?? '';
		agentPhone = source.agentPhone ?? '';
		agentEmail = source.agentEmail ?? '';
		totalCost = source.totalCost?.toString() ?? '';
		monthlyCost = source.monthlyCost?.toString() ?? '';
		premiumFrequency = source.premiumFrequency ?? '';
		paymentAmount = source.paymentAmount?.toString() ?? '';
	}

	function toggleVehicle(id: string) {
		if (selectedVehicleIds.includes(id)) {
			selectedVehicleIds = selectedVehicleIds.filter(v => v !== id);
		} else {
			selectedVehicleIds = [...selectedVehicleIds, id];
		}
	}

	function validate(): boolean {
		const newErrors: FormErrors = {};
		if (!startDate) newErrors.startDate = 'Start date is required';
		if (!endDate) newErrors.endDate = 'End date is required';
		if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
			newErrors.endDate = 'End date must be after start date';
		}
		if (selectedVehicleIds.length === 0) newErrors.vehicles = 'At least one vehicle is required';
		const isAtMost = (raw: string, bound: number) => {
			const amount = enteredAmount(raw);
			return amount !== undefined && amount <= bound;
		};
		const isNegative = (raw: string) => (enteredAmount(raw) ?? 0) < 0;
		if (isAtMost(deductibleAmount, 0)) newErrors.deductibleAmount = 'Must be positive';
		if (isAtMost(coverageLimit, 0)) newErrors.coverageLimit = 'Must be positive';
		if (isNegative(totalCost)) newErrors.totalCost = 'Must be non-negative';
		if (isNegative(monthlyCost)) newErrors.monthlyCost = 'Must be non-negative';
		if (isNegative(paymentAmount)) newErrors.paymentAmount = 'Must be non-negative';
		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	// JSON drops undefined; send null to clear an emptied field.
	function buildTermData(forEdit = false): Record<string, unknown> {
		const data: Record<string, unknown> = {};
		const str = (key: string, raw: string) => {
			const v = raw.trim();
			if (v) data[key] = v;
			else if (forEdit) data[key] = null;
		};
		const num = (key: string, raw: string) => {
			const amount = enteredAmount(raw);
			if (amount !== undefined) data[key] = amount;
			else if (forEdit) data[key] = null;
		};
		str('policyNumber', policyNumber);
		str('coverageDescription', coverageDescription);
		num('deductibleAmount', deductibleAmount);
		num('coverageLimit', coverageLimit);
		str('agentName', agentName);
		str('agentPhone', agentPhone);
		str('agentEmail', agentEmail);
		num('totalCost', totalCost);
		num('monthlyCost', monthlyCost);
		if (premiumFrequency) data['premiumFrequency'] = premiumFrequency;
		else if (forEdit) data['premiumFrequency'] = null;
		num('paymentAmount', paymentAmount);
		return data;
	}

	async function handleSubmit(event?: Event) {
		event?.preventDefault();
		if (!validate()) return;

		isSubmitting = true;
		try {
			const vehicleCoverage = { vehicleIds: selectedVehicleIds };

			if (isEditMode && termId) {
				await insuranceApi.updateTerm(policyId, termId, {
					startDate: dateOnlyToISO(startDate),
					endDate: dateOnlyToISO(endDate),
					...buildTermData(true),
					vehicleCoverage
				});
				appStore.showSuccess('Term updated successfully');
			} else {
				await insuranceApi.addTerm(policyId, {
					startDate: dateOnlyToISO(startDate),
					endDate: dateOnlyToISO(endDate),
					...buildTermData(),
					vehicleCoverage
				});
				appStore.showSuccess(renewFrom ? 'Term renewed successfully' : 'Term added successfully');
			}
			gotoDynamic(returnTo);
		} catch (err) {
			appStore.showError(
				`Couldn't ${isEditMode ? 'update' : 'add'} the term. ${userFacingErrorMessage(err)}`
			);
		} finally {
			isSubmitting = false;
		}
	}

	function handleBack() {
		gotoDynamic(returnTo);
	}
</script>

<FormLayout>
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if loadError}
		<div class="space-y-6">
			<PageHeader title={pageTitle}>
				{#snippet back()}
					<Button
						variant="ghost"
						size="icon-lg"
						class="shrink-0"
						aria-label="Go back"
						onclick={handleBack}
					>
						<ArrowLeft class="size-5" />
					</Button>
				{/snippet}
			</PageHeader>
			<LoadErrorCard title="Couldn't load this policy" message={loadError} onRetry={loadData} />
		</div>
	{:else}
		<div class="space-y-6">
			<PageHeader title={pageTitle} description={policy?.company}>
				{#snippet back()}
					<Button
						variant="ghost"
						size="icon-lg"
						class="shrink-0"
						aria-label="Go back"
						onclick={handleBack}
					>
						<ArrowLeft class="size-5" />
					</Button>
				{/snippet}
			</PageHeader>

			<form onsubmit={handleSubmit} class="space-y-6 pb-32 sm:pb-24 lg:pb-0 short:pb-0">
				<Card>
					<CardHeader>
						<CardTitle>Coverage Period</CardTitle>
						<CardDescription>Start and end dates for this term</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="start-date">Start Date *</Label>
								<DatePicker
									id="start-date"
									bind:value={startDate}
									class={errors.startDate ? 'border-destructive' : ''}
									aria-invalid={!!errors.startDate}
									aria-describedby={errors.startDate ? 'start-date-error' : undefined}
									placeholder="Pick start date"
								/>
								{#if errors.startDate}
									<FormFieldError id="start-date-error">{errors.startDate}</FormFieldError>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="end-date">End Date *</Label>
								<DatePicker
									id="end-date"
									bind:value={endDate}
									class={errors.endDate ? 'border-destructive' : ''}
									aria-invalid={!!errors.endDate}
									aria-describedby={errors.endDate ? 'end-date-error' : undefined}
									placeholder="Pick end date"
								/>
								{#if errors.endDate}
									<FormFieldError id="end-date-error">{errors.endDate}</FormFieldError>
								{/if}
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Finance Details</CardTitle>
						<CardDescription>Cost and payment information for this term</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="total-cost">Total Cost ({currencySymbol})</Label>
								<Input
									id="total-cost"
									type="number"
									step={amountStep()}
									min="0"
									bind:value={totalCost}
									aria-invalid={!!errors.totalCost}
								/>
								{#if errors.totalCost}
									<FormFieldError>{errors.totalCost}</FormFieldError>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="monthly-cost">Monthly Cost ({currencySymbol})</Label>
								<Input
									id="monthly-cost"
									type="number"
									step={amountStep()}
									min="0"
									bind:value={monthlyCost}
									aria-invalid={!!errors.monthlyCost}
								/>
								{#if errors.monthlyCost}
									<FormFieldError>{errors.monthlyCost}</FormFieldError>
								{/if}
							</div>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
							<div class="space-y-2">
								<Label for="payment-amount">Payment Amount ({currencySymbol})</Label>
								<Input
									id="payment-amount"
									type="number"
									step={amountStep()}
									min="0"
									bind:value={paymentAmount}
									aria-invalid={!!errors.paymentAmount}
								/>
								{#if errors.paymentAmount}
									<FormFieldError>{errors.paymentAmount}</FormFieldError>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="premium-frequency">Premium Frequency</Label>
								<Select.Root
									type="single"
									value={premiumFrequency}
									onValueChange={v => {
										premiumFrequency = v ?? '';
									}}
								>
									<Select.Trigger id="premium-frequency" class="w-full">
										{premiumFrequency || 'Select frequency'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="Monthly" label="Monthly">Monthly</Select.Item>
										<Select.Item value="Quarterly" label="Quarterly">Quarterly</Select.Item>
										<Select.Item value="Semi-Annual" label="Semi-Annual">Semi-Annual</Select.Item>
										<Select.Item value="Annual" label="Annual">Annual</Select.Item>
										<Select.Item value="One-Time" label="One-Time">One-Time</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Covered Vehicles</CardTitle>
						<CardDescription>Select which vehicles this term covers</CardDescription>
					</CardHeader>
					<CardContent>
						{#if vehicles.length > 0}
							<div class="rounded-md border border-input p-3 space-y-2">
								{#each vehicles as v (v.id)}
									<label class="flex min-h-10 items-center gap-2 cursor-pointer">
										<Checkbox
											checked={selectedVehicleIds.includes(v.id)}
											onCheckedChange={() => toggleVehicle(v.id)}
										/>
										<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
									</label>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">
								{addVehicleFirstTo('cover it under this term')}
							</p>
						{/if}
						{#if errors.vehicles}
							<FormFieldError id="vehicles-error">{errors.vehicles}</FormFieldError>
						{/if}

						{#if showSplitEditor}
							<div class="mt-4 space-y-2">
								<p class="text-xs text-muted-foreground">
									{premiumFromMonthlyCost
										? 'The premium is the monthly cost for each billed month of the term, split evenly between the covered vehicles.'
										: 'The premium is split evenly between the covered vehicles.'}
								</p>
								<SplitConfigEditor
									vehicles={splitVehicles}
									totalAmount={premiumTotal}
									splitMethod="even"
									allocations={[]}
								/>
							</div>
						{/if}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div class="flex items-center gap-2">
							<FileText class="h-5 w-5 text-primary" />
							<CardTitle>Policy Details</CardTitle>
						</div>
						<CardDescription>Policy number, coverage, and agent information</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="policy-number">Policy Number</Label>
								<Input id="policy-number" placeholder="e.g. SF-12345" bind:value={policyNumber} />
							</div>
							<div class="space-y-2">
								<Label for="deductible">Deductible ({currencySymbol})</Label>
								<Input
									id="deductible"
									type="number"
									step={amountStep()}
									min="0"
									bind:value={deductibleAmount}
									aria-invalid={!!errors.deductibleAmount}
								/>
								{#if errors.deductibleAmount}
									<FormFieldError>{errors.deductibleAmount}</FormFieldError>
								{/if}
							</div>
						</div>

						<div class="space-y-2">
							<Label for="coverage-desc">Coverage Description</Label>
							<Textarea
								id="coverage-desc"
								placeholder="Describe coverage details"
								bind:value={coverageDescription}
								rows={2}
							/>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="coverage-limit">Coverage Limit ({currencySymbol})</Label>
								<Input
									id="coverage-limit"
									type="number"
									step={amountStep()}
									min="0"
									bind:value={coverageLimit}
									aria-invalid={!!errors.coverageLimit}
								/>
								{#if errors.coverageLimit}
									<FormFieldError>{errors.coverageLimit}</FormFieldError>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="agent-name">Agent Name</Label>
								<Input id="agent-name" bind:value={agentName} />
							</div>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="agent-phone">Agent Phone</Label>
								<Input id="agent-phone" type="tel" bind:value={agentPhone} />
							</div>
							<div class="space-y-2">
								<Label for="agent-email">Agent Email</Label>
								<Input id="agent-email" type="email" bind:value={agentEmail} />
							</div>
						</div>
					</CardContent>
				</Card>
			</form>

			<div
				class="fixed bottom-4 left-4 right-4 z-50 sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto lg:static lg:z-auto lg:mt-6 short:static short:z-auto short:mt-6"
			>
				<div
					class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none border sm:border-0 short:bg-transparent short:p-0 short:rounded-none short:shadow-none short:border-0"
				>
					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={handleBack}
						disabled={isSubmitting}
						class="rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 px-5 flex-shrink-0"
					>
						<X class="h-5 w-5 sm:mr-2" />
						<span class="max-sm:sr-only font-semibold">Cancel</span>
					</Button>

					<Button
						type="button"
						size="lg"
						onclick={handleSubmit}
						disabled={isSubmitting}
						class="rounded-full shadow-sm transition-colors h-14 px-6 flex-1 sm:flex-initial"
					>
						{#if isSubmitting}
							<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
							<span class="font-bold">Saving...</span>
						{:else}
							<Check class="h-5 w-5 mr-2" />
							<span class="font-bold">{isEditMode ? 'Update' : 'Save'} Term</span>
						{/if}
					</Button>
				</div>
			</div>
		</div>
	{/if}
</FormLayout>
