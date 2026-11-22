<script lang="ts">
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import { ArrowLeft, CircleAlert, Shield, Trash2, X, Check, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
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
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '#lib/components/ui/alert-dialog/index.ts';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { dateOnlyToISO, getCurrencySymbol } from '#lib/utils/formatters.ts';
	import { enteredAmount } from '#lib/utils/insurance.ts';
	import type { InsurancePolicy, Vehicle, CreateTermRequest } from '#lib/types/index.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';

	const currencySymbol = $derived(getCurrencySymbol());

	interface Props {
		policyId?: string;
		preselectedVehicleId?: string | null;
		returnTo?: string;
	}

	let { policyId, preselectedVehicleId = null, returnTo = '/insurance' }: Props = $props();

	const isEditMode = $derived(!!policyId);

	let isLoading = $state(true);
	let isSubmitting = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting));
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let vehicles = $state<Vehicle[]>([]);
	let policy = $state<InsurancePolicy | null>(null);

	let company = $state('');
	let selectedVehicleIds = $state<string[]>([]);
	let notes = $state('');
	let isActive = $state(true);

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
	let premiumFrequency = $state('');
	let monthlyCost = $state('');
	let paymentAmount = $state('');

	interface FormErrors {
		company?: string;
		vehicles?: string;
		startDate?: string;
		endDate?: string;
		deductibleAmount?: string;
		coverageLimit?: string;
		totalCost?: string;
	}
	let errors = $state<FormErrors>({});

	let loadError = $state<string | null>(null);
	let pageTitle = $derived(isEditMode ? 'Edit Policy' : 'New Insurance Policy');

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		loadError = null;
		try {
			vehicles = await vehicleApi.getVehicles();
			if (isEditMode && policyId) {
				await loadPolicy();
			} else if (preselectedVehicleId) {
				selectedVehicleIds = [preselectedVehicleId];
			}
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to load data:', err);
			if (isEditMode && err instanceof ApiError && err.statusCode === 404) {
				appStore.showError('That policy no longer exists.');
				gotoDynamic(returnTo);
				return;
			}
			loadError = userFacingErrorMessage(err);
		} finally {
			isLoading = false;
		}
	}

	async function loadPolicy() {
		policy = await insuranceApi.getPolicy(policyId!);
		company = policy.company;
		selectedVehicleIds = [...policy.vehicleIds];
		notes = policy.notes ?? '';
		isActive = policy.isActive;
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

		if (!company.trim()) {
			newErrors.company = 'Company name is required';
		}
		if (selectedVehicleIds.length === 0) {
			newErrors.vehicles = 'At least one vehicle is required';
		}

		if (!isEditMode) {
			if (!startDate) newErrors.startDate = 'Start date is required';
			if (!endDate) newErrors.endDate = 'End date is required';
			if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
				newErrors.endDate = 'End date must be after start date';
			}
			const deductible = enteredAmount(deductibleAmount);
			const limit = enteredAmount(coverageLimit);
			const cost = enteredAmount(totalCost);
			if (deductible !== undefined && deductible <= 0) {
				newErrors.deductibleAmount = 'Must be positive';
			}
			if (limit !== undefined && limit <= 0) {
				newErrors.coverageLimit = 'Must be positive';
			}
			if (cost !== undefined && cost < 0) {
				newErrors.totalCost = 'Must be non-negative';
			}
		}

		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	async function handleSubmit(event?: Event) {
		event?.preventDefault();
		if (!validate()) return;

		isSubmitting = true;
		try {
			if (isEditMode && policy) {
				await insuranceApi.updatePolicy(policy.id, {
					company: company.trim(),
					// JSON drops undefined; send null to clear the notes.
					notes: notes.trim() || null,
					isActive
				});
				appStore.showSuccess('Policy updated successfully');
				gotoDynamic(returnTo);
			} else {
				const termData: Record<string, unknown> = {};
				const amount = (key: string, raw: string) => {
					const value = enteredAmount(raw);
					if (value !== undefined) termData[key] = value;
				};
				if (policyNumber.trim()) termData['policyNumber'] = policyNumber.trim();
				if (coverageDescription.trim())
					termData['coverageDescription'] = coverageDescription.trim();
				amount('deductibleAmount', deductibleAmount);
				amount('coverageLimit', coverageLimit);
				if (agentName.trim()) termData['agentName'] = agentName.trim();
				if (agentPhone.trim()) termData['agentPhone'] = agentPhone.trim();
				if (agentEmail.trim()) termData['agentEmail'] = agentEmail.trim();
				amount('totalCost', totalCost);
				amount('monthlyCost', monthlyCost);
				if (premiumFrequency) termData['premiumFrequency'] = premiumFrequency;
				amount('paymentAmount', paymentAmount);

				await insuranceApi.createPolicy({
					company: company.trim(),
					terms: [
						{
							startDate: dateOnlyToISO(startDate),
							endDate: dateOnlyToISO(endDate),
							...termData,
							vehicleCoverage: {
								vehicleIds: selectedVehicleIds
							}
						} as CreateTermRequest
					],
					notes: notes.trim() || undefined,
					isActive
				});
				appStore.showSuccess('Policy created successfully');
				goto(resolve(routes.insurance));
			}
		} catch (err) {
			appStore.showError(
				`Couldn't ${isEditMode ? 'update' : 'create'} the policy. ${userFacingErrorMessage(err)}`
			);
		} finally {
			isSubmitting = false;
		}
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function handleDelete() {
		if (!policy) return;
		isDeleting = true;
		try {
			await insuranceApi.deletePolicy(policy.id);
			appStore.showSuccess('Policy deleted successfully');
			goto(resolve(routes.insurance));
		} catch (err) {
			appStore.showError(`Couldn't delete the policy. ${userFacingErrorMessage(err)}`);
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
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
			<div class="rounded-lg border bg-card p-6">
				<div class="mb-4 flex items-center gap-3 text-destructive">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">
						{isEditMode ? "Couldn't load this policy" : "Couldn't load your vehicles"}
					</p>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
				<Button size="lg" onclick={loadData}>Retry</Button>
			</div>
		</div>
	{:else}
		<div class="space-y-6">
			<PageHeader
				title={pageTitle}
				description={isEditMode
					? company || undefined
					: 'Add a new insurance policy with an initial term'}
			>
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

			<form onsubmit={handleSubmit} class="space-y-6 pb-32 sm:pb-24">
				<Card>
					<CardHeader>
						<div class="flex items-center gap-2">
							<Shield class="h-5 w-5 text-primary" />
							<CardTitle level={2}>Policy Information</CardTitle>
						</div>
						<CardDescription>Basic details about the insurance policy</CardDescription>
					</CardHeader>
					<CardContent class="space-y-6">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="company">Insurance Company *</Label>
								<Input
									id="company"
									placeholder="e.g. State Farm, GEICO"
									bind:value={company}
									aria-invalid={!!errors.company}
									aria-describedby={errors.company ? 'company-error' : undefined}
									required
								/>
								{#if errors.company}
									<FormFieldError id="company-error">{errors.company}</FormFieldError>
								{/if}
							</div>

							<div class="flex items-center justify-between md:justify-start md:gap-4 pt-6">
								<Label for="policy-active">Active Policy</Label>
								<Switch
									id="policy-active"
									checked={isActive}
									onCheckedChange={v => (isActive = v)}
								/>
							</div>
						</div>

						<div class="space-y-2">
							<Label for="notes">Notes</Label>
							<Textarea
								id="notes"
								placeholder="Optional notes about this policy"
								bind:value={notes}
								rows={2}
							/>
						</div>
					</CardContent>
				</Card>

				{#if !isEditMode}
					<Card>
						<CardHeader>
							<CardTitle level={2}>Initial Term</CardTitle>
							<CardDescription>
								Coverage period, vehicles, policy details, and costs for the first term
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-6">
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

							<div class="space-y-2">
								<Label>Covered Vehicles *</Label>
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
									{#if vehicles.length === 0}
										<p class="text-sm text-muted-foreground">
											No vehicles found. Add a vehicle first.
										</p>
									{/if}
								</div>
								{#if errors.vehicles}
									<FormFieldError id="vehicles-error">{errors.vehicles}</FormFieldError>
								{/if}
							</div>

							<div class="border-t border-border pt-6">
								<h3 class="text-sm font-medium text-foreground mb-4">Policy Details</h3>
								<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
									<div class="space-y-2">
										<Label for="policy-number">Policy Number</Label>
										<Input
											id="policy-number"
											placeholder="e.g. SF-12345"
											bind:value={policyNumber}
										/>
									</div>
									<div class="space-y-2">
										<Label for="deductible">Deductible ({currencySymbol})</Label>
										<Input
											id="deductible"
											type="number"
											step="0.01"
											min="0"
											bind:value={deductibleAmount}
											aria-invalid={!!errors.deductibleAmount}
											aria-describedby={errors.deductibleAmount ? 'deductible-error' : undefined}
										/>
										{#if errors.deductibleAmount}
											<FormFieldError id="deductible-error">
												{errors.deductibleAmount}
											</FormFieldError>
										{/if}
									</div>
								</div>

								<div class="space-y-2 mt-4">
									<Label for="coverage-desc">Coverage Description</Label>
									<Textarea
										id="coverage-desc"
										placeholder="Describe coverage details"
										bind:value={coverageDescription}
										rows={2}
									/>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
									<div class="space-y-2">
										<Label for="coverage-limit">Coverage Limit ({currencySymbol})</Label>
										<Input
											id="coverage-limit"
											type="number"
											step="0.01"
											min="0"
											bind:value={coverageLimit}
											aria-invalid={!!errors.coverageLimit}
											aria-describedby={errors.coverageLimit ? 'coverage-limit-error' : undefined}
										/>
										{#if errors.coverageLimit}
											<FormFieldError id="coverage-limit-error">
												{errors.coverageLimit}
											</FormFieldError>
										{/if}
									</div>
									<div class="space-y-2">
										<Label for="agent-name">Agent Name</Label>
										<Input id="agent-name" bind:value={agentName} />
									</div>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
									<div class="space-y-2">
										<Label for="agent-phone">Agent Phone</Label>
										<Input id="agent-phone" type="tel" bind:value={agentPhone} />
									</div>
									<div class="space-y-2">
										<Label for="agent-email">Agent Email</Label>
										<Input id="agent-email" type="email" bind:value={agentEmail} />
									</div>
								</div>
							</div>

							<div class="border-t border-border pt-6">
								<h3 class="text-sm font-medium text-foreground mb-4">Finance Details</h3>
								<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
									<div class="space-y-2">
										<Label for="total-cost">Total Cost ({currencySymbol})</Label>
										<Input
											id="total-cost"
											type="number"
											step="0.01"
											min="0"
											bind:value={totalCost}
											aria-invalid={!!errors.totalCost}
											aria-describedby={errors.totalCost ? 'total-cost-error' : undefined}
										/>
										{#if errors.totalCost}
											<FormFieldError id="total-cost-error">{errors.totalCost}</FormFieldError>
										{/if}
									</div>
									<div class="space-y-2">
										<Label for="monthly-cost">Monthly Cost ({currencySymbol})</Label>
										<Input
											id="monthly-cost"
											type="number"
											step="0.01"
											min="0"
											bind:value={monthlyCost}
										/>
									</div>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
									<div class="space-y-2">
										<Label for="payment-amount">Payment Amount ({currencySymbol})</Label>
										<Input
											id="payment-amount"
											type="number"
											step="0.01"
											min="0"
											bind:value={paymentAmount}
										/>
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
												<Select.Item value="Semi-Annual" label="Semi-Annual">
													Semi-Annual
												</Select.Item>
												<Select.Item value="Annual" label="Annual">Annual</Select.Item>
												<Select.Item value="One-Time" label="One-Time">One-Time</Select.Item>
											</Select.Content>
										</Select.Root>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}
			</form>

			<div class="fixed bottom-4 left-4 right-4 z-50 sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto">
				<div
					class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none border sm:border-0"
				>
					{#if isEditMode}
						<Button
							type="button"
							variant="outline"
							size="lg"
							onclick={confirmDelete}
							disabled={isDeleting || isSubmitting}
							class="rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 px-5 flex-shrink-0"
						>
							<Trash2 class="h-5 w-5 sm:mr-2 text-destructive" />
							<span class="max-sm:sr-only font-semibold">Delete</span>
						</Button>
					{/if}

					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={handleBack}
						disabled={isSubmitting || isDeleting}
						class="rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 px-5 flex-shrink-0"
					>
						<X class="h-5 w-5 sm:mr-2" />
						<span class="max-sm:sr-only font-semibold">Cancel</span>
					</Button>

					<Button
						type="button"
						size="lg"
						onclick={handleSubmit}
						disabled={isSubmitting || isDeleting}
						class="rounded-full group shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 px-6 flex-1 sm:flex-initial"
					>
						{#if isSubmitting}
							<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
							<span class="font-bold">{isEditMode ? 'Updating' : 'Creating'}...</span>
						{:else}
							<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
							<span class="font-bold">{isEditMode ? 'Update' : 'Create'} Policy</span>
						{/if}
					</Button>
				</div>
			</div>
		</div>

		<AlertDialog bind:open={showDeleteConfirm}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Policy</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete this insurance policy? This permanently removes the
						policy and everything under it — all terms, filed claims, and uploaded documents. This
						action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{#if policy}
					<Card class="bg-muted/50">
						<CardContent class="p-4">
							<div class="flex items-center gap-3">
								<div class="p-2 rounded-lg bg-destructive/10 text-destructive">
									<Shield class="h-4 w-4" />
								</div>
								<div>
									<p class="font-medium">{policy.company}</p>
									<p class="text-sm text-muted-foreground">
										{policy.vehicleIds.length} vehicle{policy.vehicleIds.length === 1 ? '' : 's'} covered
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onclick={handleDelete}
						disabled={isDeleting}
						class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{#if isDeleting}
							<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
							Deleting...
						{:else}
							<Trash2 class="h-4 w-4 mr-2" />
							Delete Policy
						{/if}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	{/if}
</FormLayout>
