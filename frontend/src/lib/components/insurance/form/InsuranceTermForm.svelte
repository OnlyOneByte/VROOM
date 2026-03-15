<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { routes } from '$lib/routes';
	import { gotoDynamic } from '$lib/utils/navigation';
	import { appStore } from '$lib/stores/app.svelte';
	import { ArrowLeft, Check, LoaderCircle, X, FileText } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import SplitConfigEditor from '$lib/components/expenses/split/SplitConfigEditor.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { prefillFromPreviousTerm } from '$lib/utils/insurance';
	import type { InsurancePolicy, InsuranceTerm, Vehicle } from '$lib/types';

	interface Props {
		policyId: string;
		termId?: string;
		renewFrom?: string;
		returnTo?: string;
	}

	let { policyId, termId, renewFrom, returnTo = '/insurance' }: Props = $props();

	const isEditMode = !!termId;

	let isLoading = $state(true);
	let isSubmitting = $state(false);
	let policy = $state<InsurancePolicy | null>(null);
	let vehicles = $state<Vehicle[]>([]);

	// Form fields
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

	// Split state
	let splitMethod = $state<'even' | 'absolute' | 'percentage'>('even');
	let splitAllocations = $state<Array<{ vehicleId: string; amount?: number; percentage?: number }>>(
		[]
	);
	let splitVehicles = $derived(vehicles.filter(v => selectedVehicleIds.includes(v.id)));
	let parsedTotalCost = $derived(parseFloat(totalCost) || 0);
	let showSplitEditor = $derived(parsedTotalCost > 0 && selectedVehicleIds.length >= 2);

	// Validation
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

	// Derive title
	let pageTitle = $derived(isEditMode ? 'Edit Term' : renewFrom ? 'Renew Term' : 'Add Term');

	onMount(async () => {
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
					appStore.showError('Term not found');
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
			appStore.showError('Failed to load data');
			gotoDynamic(returnTo);
		} finally {
			isLoading = false;
		}
	});

	function populateFromTerm(source: InsuranceTerm | Partial<InsuranceTerm>) {
		if (source.startDate) {
			const s = typeof source.startDate === 'string' ? source.startDate : '';
			startDate = s.split('T')[0] ?? s;
		}
		if (source.endDate) {
			const e = typeof source.endDate === 'string' ? source.endDate : '';
			endDate = e.split('T')[0] ?? e;
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
		resetAllocationsForMethod(splitMethod);
	}

	function handleSplitMethodChange(method: 'even' | 'absolute' | 'percentage') {
		splitMethod = method;
		resetAllocationsForMethod(method);
	}

	function resetAllocationsForMethod(method: 'even' | 'absolute' | 'percentage') {
		if (method === 'even') {
			splitAllocations = [];
		} else if (method === 'absolute') {
			splitAllocations = selectedVehicleIds.map(id => ({ vehicleId: id, amount: 0 }));
		} else {
			const pct = selectedVehicleIds.length > 0 ? 100 / selectedVehicleIds.length : 0;
			splitAllocations = selectedVehicleIds.map(id => ({
				vehicleId: id,
				percentage: Math.round(pct * 10) / 10
			}));
		}
	}

	function handleAllocationsChange(
		allocs: Array<{ vehicleId: string; amount?: number; percentage?: number }>
	) {
		splitAllocations = allocs;
	}

	function validate(): boolean {
		const newErrors: FormErrors = {};
		if (!startDate) newErrors.startDate = 'Start date is required';
		if (!endDate) newErrors.endDate = 'End date is required';
		if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
			newErrors.endDate = 'End date must be after start date';
		}
		if (selectedVehicleIds.length === 0) newErrors.vehicles = 'At least one vehicle is required';
		if (deductibleAmount && Number(deductibleAmount) <= 0)
			newErrors.deductibleAmount = 'Must be positive';
		if (coverageLimit && Number(coverageLimit) <= 0) newErrors.coverageLimit = 'Must be positive';
		if (totalCost && Number(totalCost) < 0) newErrors.totalCost = 'Must be non-negative';
		if (monthlyCost && Number(monthlyCost) < 0) newErrors.monthlyCost = 'Must be non-negative';
		if (paymentAmount && Number(paymentAmount) < 0)
			newErrors.paymentAmount = 'Must be non-negative';
		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	function buildTermData(): Record<string, unknown> {
		const data: Record<string, unknown> = {};
		if (policyNumber.trim()) data['policyNumber'] = policyNumber.trim();
		if (coverageDescription.trim()) data['coverageDescription'] = coverageDescription.trim();
		if (deductibleAmount) data['deductibleAmount'] = Number(deductibleAmount);
		if (coverageLimit) data['coverageLimit'] = Number(coverageLimit);
		if (agentName.trim()) data['agentName'] = agentName.trim();
		if (agentPhone.trim()) data['agentPhone'] = agentPhone.trim();
		if (agentEmail.trim()) data['agentEmail'] = agentEmail.trim();
		if (totalCost) data['totalCost'] = Number(totalCost);
		if (monthlyCost) data['monthlyCost'] = Number(monthlyCost);
		if (premiumFrequency) data['premiumFrequency'] = premiumFrequency;
		if (paymentAmount) data['paymentAmount'] = Number(paymentAmount);
		return data;
	}

	async function handleSubmit(event?: Event) {
		event?.preventDefault();
		if (!validate()) return;

		isSubmitting = true;
		try {
			const vehicleCoverage = {
				vehicleIds: selectedVehicleIds,
				splitMethod: splitMethod !== 'even' ? splitMethod : undefined,
				allocations: splitMethod !== 'even' ? splitAllocations : undefined
			};
			const termData = buildTermData();

			if (isEditMode && termId) {
				await insuranceApi.updateTerm(policyId, termId, {
					startDate,
					endDate,
					...termData,
					vehicleCoverage
				});
				appStore.showSuccess('Term updated successfully');
			} else {
				await insuranceApi.addTerm(policyId, {
					startDate,
					endDate,
					...termData,
					vehicleCoverage
				});
				appStore.showSuccess(renewFrom ? 'Term renewed successfully' : 'Term added successfully');
			}
			goto(resolve(routes.insurance));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			appStore.showError(`Failed to ${isEditMode ? 'update' : 'add'} term: ${message}`);
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
	{:else}
		<div class="space-y-6">
			<!-- Header -->
			<div class="flex items-center gap-4">
				<Button variant="outline" size="icon" onclick={handleBack}>
					<ArrowLeft class="h-4 w-4" />
				</Button>
				<div>
					<h1 class="text-3xl font-bold tracking-tight">{pageTitle}</h1>
					{#if policy}
						<p class="text-muted-foreground mt-1">{policy.company}</p>
					{/if}
				</div>
			</div>

			<form onsubmit={handleSubmit} class="space-y-6 pb-32 sm:pb-24">
				<!-- Coverage Period -->
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
									placeholder="Pick end date"
								/>
								{#if errors.endDate}
									<FormFieldError id="end-date-error">{errors.endDate}</FormFieldError>
								{/if}
							</div>
						</div>
					</CardContent>
				</Card>

				<!-- Finance Details -->
				<Card>
					<CardHeader>
						<CardTitle>Finance Details</CardTitle>
						<CardDescription>Cost and payment information for this term</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="total-cost">Total Cost ($)</Label>
								<Input
									id="total-cost"
									type="number"
									step="0.01"
									min="0"
									bind:value={totalCost}
									aria-invalid={!!errors.totalCost}
								/>
								{#if errors.totalCost}
									<FormFieldError>{errors.totalCost}</FormFieldError>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="monthly-cost">Monthly Cost ($)</Label>
								<Input
									id="monthly-cost"
									type="number"
									step="0.01"
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
								<Label for="payment-amount">Payment Amount ($)</Label>
								<Input
									id="payment-amount"
									type="number"
									step="0.01"
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
									onValueChange={(v) => {
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

				<!-- Vehicle Coverage -->
				<Card>
					<CardHeader>
						<CardTitle>Covered Vehicles</CardTitle>
						<CardDescription>Select which vehicles this term covers</CardDescription>
					</CardHeader>
					<CardContent>
						{#if vehicles.length > 0}
							<div class="rounded-md border border-input p-3 space-y-2">
								{#each vehicles as v (v.id)}
									<label class="flex items-center gap-2 cursor-pointer">
										<Checkbox
											checked={selectedVehicleIds.includes(v.id)}
											onCheckedChange={() => toggleVehicle(v.id)}
										/>
										<span class="text-sm text-foreground">{getVehicleDisplayName(v)}</span>
									</label>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">No vehicles found. Add a vehicle first.</p>
						{/if}
						{#if errors.vehicles}
							<FormFieldError id="vehicles-error">{errors.vehicles}</FormFieldError>
						{/if}

						{#if showSplitEditor}
							<div class="mt-4">
								<SplitConfigEditor
									vehicles={splitVehicles}
									totalAmount={parsedTotalCost}
									{splitMethod}
									allocations={splitAllocations}
									onMethodChange={handleSplitMethodChange}
									onAllocationsChange={handleAllocationsChange}
								/>
							</div>
						{/if}
					</CardContent>
				</Card>

				<!-- Policy Details -->
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
								<Label for="deductible">Deductible ($)</Label>
								<Input
									id="deductible"
									type="number"
									step="0.01"
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
								<Label for="coverage-limit">Coverage Limit ($)</Label>
								<Input
									id="coverage-limit"
									type="number"
									step="0.01"
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

			<!-- Floating Action Bar -->
			<div class="fixed bottom-4 left-4 right-4 z-50 sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto">
				<div
					class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none border sm:border-0"
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
						<span class="hidden sm:inline font-semibold">Cancel</span>
					</Button>

					<Button
						type="button"
						size="lg"
						onclick={handleSubmit}
						disabled={isSubmitting}
						class="rounded-full group shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 px-6 flex-1 sm:flex-initial"
					>
						{#if isSubmitting}
							<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
							<span class="font-bold">Saving...</span>
						{:else}
							<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
							<span class="font-bold">{isEditMode ? 'Update' : 'Save'} Term</span>
						{/if}
					</Button>
				</div>
			</div>
		</div>
	{/if}
</FormLayout>
