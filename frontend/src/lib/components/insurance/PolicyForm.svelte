<script lang="ts">
	import { LoaderCircle, Save } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { InsurancePolicy, Vehicle, PolicyDetails, FinanceDetails } from '$lib/types';

	interface Props {
		open: boolean;
		vehicleId: string;
		policy?: InsurancePolicy | null;
		vehicles: Vehicle[];
		onSuccess: () => void;
	}

	let { open = $bindable(false), vehicleId, policy = null, vehicles, onSuccess }: Props = $props();

	let isEdit = $derived(!!policy);

	// Form state
	let company = $state('');
	let selectedVehicleIds = $state<string[]>([]);
	let notes = $state('');
	let isActive = $state(true);
	let isSaving = $state(false);

	// Initial term fields (only for create)
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

	// Validation errors
	interface FormErrors {
		company?: string;
		vehicles?: string;
		startDate?: string;
		endDate?: string;
		deductibleAmount?: string;
		coverageLimit?: string;
		totalCost?: string;
		monthlyCost?: string;
		paymentAmount?: string;
	}
	let errors = $state<FormErrors>({});

	// Reset form when dialog opens
	$effect(() => {
		if (open) {
			if (policy) {
				company = policy.company;
				selectedVehicleIds = [...policy.vehicleIds];
				notes = policy.notes ?? '';
				isActive = policy.isActive;
			} else {
				company = '';
				selectedVehicleIds = vehicleId ? [vehicleId] : [];
				notes = '';
				isActive = true;
			}
			// Reset term fields
			startDate = '';
			endDate = '';
			policyNumber = '';
			coverageDescription = '';
			deductibleAmount = '';
			coverageLimit = '';
			agentName = '';
			agentPhone = '';
			agentEmail = '';
			totalCost = '';
			monthlyCost = '';
			premiumFrequency = '';
			paymentAmount = '';
			errors = {};
			isSaving = false;
		}
	});

	function toggleVehicle(id: string) {
		if (selectedVehicleIds.includes(id)) {
			selectedVehicleIds = selectedVehicleIds.filter(v => v !== id);
		} else {
			selectedVehicleIds = [...selectedVehicleIds, id];
		}
	}

	function getVehicleLabel(v: Vehicle): string {
		return v.nickname || `${v.year} ${v.make} ${v.model}`;
	}

	function validate(): boolean {
		const newErrors: FormErrors = {};

		if (!company.trim()) {
			newErrors.company = 'Company name is required';
		}
		if (selectedVehicleIds.length === 0) {
			newErrors.vehicles = 'At least one vehicle is required';
		}

		if (!isEdit) {
			if (!startDate) newErrors.startDate = 'Start date is required';
			if (!endDate) newErrors.endDate = 'End date is required';
			if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
				newErrors.endDate = 'End date must be after start date';
			}
			if (deductibleAmount && Number(deductibleAmount) <= 0) {
				newErrors.deductibleAmount = 'Must be positive';
			}
			if (coverageLimit && Number(coverageLimit) <= 0) {
				newErrors.coverageLimit = 'Must be positive';
			}
			if (totalCost && Number(totalCost) < 0) {
				newErrors.totalCost = 'Must be non-negative';
			}
			if (monthlyCost && Number(monthlyCost) < 0) {
				newErrors.monthlyCost = 'Must be non-negative';
			}
			if (paymentAmount && Number(paymentAmount) < 0) {
				newErrors.paymentAmount = 'Must be non-negative';
			}
		}

		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	async function handleSubmit() {
		if (!validate()) return;

		isSaving = true;
		try {
			if (isEdit && policy) {
				await insuranceApi.updatePolicy(policy.id, {
					company: company.trim(),
					vehicleIds: selectedVehicleIds,
					notes: notes.trim() || undefined,
					isActive
				});
			} else {
				const policyDetails: PolicyDetails = {};
				if (policyNumber.trim()) policyDetails.policyNumber = policyNumber.trim();
				if (coverageDescription.trim())
					policyDetails.coverageDescription = coverageDescription.trim();
				if (deductibleAmount) policyDetails.deductibleAmount = Number(deductibleAmount);
				if (coverageLimit) policyDetails.coverageLimit = Number(coverageLimit);
				if (agentName.trim()) policyDetails.agentName = agentName.trim();
				if (agentPhone.trim()) policyDetails.agentPhone = agentPhone.trim();
				if (agentEmail.trim()) policyDetails.agentEmail = agentEmail.trim();

				const financeDetails: FinanceDetails = {};
				if (totalCost) financeDetails.totalCost = Number(totalCost);
				if (monthlyCost) financeDetails.monthlyCost = Number(monthlyCost);
				if (premiumFrequency.trim()) financeDetails.premiumFrequency = premiumFrequency.trim();
				if (paymentAmount) financeDetails.paymentAmount = Number(paymentAmount);

				await insuranceApi.createPolicy({
					company: company.trim(),
					vehicleIds: selectedVehicleIds,
					terms: [
						{
							id: crypto.randomUUID(),
							startDate,
							endDate,
							policyDetails,
							financeDetails
						}
					],
					notes: notes.trim() || undefined,
					isActive
				});
			}
			onSuccess();
		} catch (err) {
			handleErrorWithNotification(
				err,
				isEdit ? 'Failed to update policy' : 'Failed to create policy'
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg max-h-[90vh]">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Edit Policy' : 'New Insurance Policy'}</Dialog.Title>
			<Dialog.Description>
				{isEdit ? 'Update policy details.' : 'Add a new insurance policy with an initial term.'}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea class="max-h-[60vh] pr-4">
			<div class="space-y-4 py-2">
				<!-- Company -->
				<div class="space-y-2">
					<Label for="policy-company">Company *</Label>
					<Input
						id="policy-company"
						placeholder="e.g. State Farm"
						bind:value={company}
						class={errors.company ? 'border-destructive' : ''}
					/>
					{#if errors.company}
						<p class="text-xs text-destructive">{errors.company}</p>
					{/if}
				</div>

				<!-- Vehicle selection -->
				<div class="space-y-2">
					<Label>Vehicles *</Label>
					<div class="space-y-2 rounded-md border border-input p-3">
						{#each vehicles as v (v.id)}
							<label class="flex items-center gap-2 cursor-pointer">
								<Checkbox
									checked={selectedVehicleIds.includes(v.id)}
									onCheckedChange={() => toggleVehicle(v.id)}
								/>
								<span class="text-sm text-foreground">{getVehicleLabel(v)}</span>
							</label>
						{/each}
					</div>
					{#if errors.vehicles}
						<p class="text-xs text-destructive">{errors.vehicles}</p>
					{/if}
				</div>

				<!-- Active toggle -->
				<div class="flex items-center justify-between">
					<Label for="policy-active">Active Policy</Label>
					<Switch id="policy-active" checked={isActive} onCheckedChange={v => (isActive = v)} />
				</div>

				<!-- Notes -->
				<div class="space-y-2">
					<Label for="policy-notes">Notes</Label>
					<Textarea
						id="policy-notes"
						placeholder="Optional notes about this policy"
						bind:value={notes}
						rows={2}
					/>
				</div>

				<!-- Initial term fields (create only) -->
				{#if !isEdit}
					<Separator />
					<h4 class="text-sm font-medium text-foreground">Initial Term</h4>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-start">Start Date *</Label>
							<Input
								id="term-start"
								type="date"
								bind:value={startDate}
								class={errors.startDate ? 'border-destructive' : ''}
							/>
							{#if errors.startDate}
								<p class="text-xs text-destructive">{errors.startDate}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label for="term-end">End Date *</Label>
							<Input
								id="term-end"
								type="date"
								bind:value={endDate}
								class={errors.endDate ? 'border-destructive' : ''}
							/>
							{#if errors.endDate}
								<p class="text-xs text-destructive">{errors.endDate}</p>
							{/if}
						</div>
					</div>

					<Separator />
					<h4 class="text-sm font-medium text-foreground">Policy Details</h4>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-policy-number">Policy Number</Label>
							<Input
								id="term-policy-number"
								placeholder="e.g. SF-12345"
								bind:value={policyNumber}
							/>
						</div>
						<div class="space-y-2">
							<Label for="term-deductible">Deductible ($)</Label>
							<Input
								id="term-deductible"
								type="number"
								step="0.01"
								min="0"
								bind:value={deductibleAmount}
								class={errors.deductibleAmount ? 'border-destructive' : ''}
							/>
							{#if errors.deductibleAmount}
								<p class="text-xs text-destructive">{errors.deductibleAmount}</p>
							{/if}
						</div>
					</div>

					<div class="space-y-2">
						<Label for="term-coverage-desc">Coverage Description</Label>
						<Textarea
							id="term-coverage-desc"
							placeholder="Describe coverage"
							bind:value={coverageDescription}
							rows={2}
						/>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-coverage-limit">Coverage Limit ($)</Label>
							<Input
								id="term-coverage-limit"
								type="number"
								step="0.01"
								min="0"
								bind:value={coverageLimit}
								class={errors.coverageLimit ? 'border-destructive' : ''}
							/>
							{#if errors.coverageLimit}
								<p class="text-xs text-destructive">{errors.coverageLimit}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label for="term-agent-name">Agent Name</Label>
							<Input id="term-agent-name" bind:value={agentName} />
						</div>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-agent-phone">Agent Phone</Label>
							<Input id="term-agent-phone" type="tel" bind:value={agentPhone} />
						</div>
						<div class="space-y-2">
							<Label for="term-agent-email">Agent Email</Label>
							<Input id="term-agent-email" type="email" bind:value={agentEmail} />
						</div>
					</div>

					<Separator />
					<h4 class="text-sm font-medium text-foreground">Finance Details</h4>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-total-cost">Total Cost ($)</Label>
							<Input
								id="term-total-cost"
								type="number"
								step="0.01"
								min="0"
								bind:value={totalCost}
								class={errors.totalCost ? 'border-destructive' : ''}
							/>
							{#if errors.totalCost}
								<p class="text-xs text-destructive">{errors.totalCost}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label for="term-monthly-cost">Monthly Cost ($)</Label>
							<Input
								id="term-monthly-cost"
								type="number"
								step="0.01"
								min="0"
								bind:value={monthlyCost}
								class={errors.monthlyCost ? 'border-destructive' : ''}
							/>
							{#if errors.monthlyCost}
								<p class="text-xs text-destructive">{errors.monthlyCost}</p>
							{/if}
						</div>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="term-frequency">Premium Frequency</Label>
							<Input id="term-frequency" placeholder="e.g. Monthly" bind:value={premiumFrequency} />
						</div>
						<div class="space-y-2">
							<Label for="term-payment">Payment Amount ($)</Label>
							<Input
								id="term-payment"
								type="number"
								step="0.01"
								min="0"
								bind:value={paymentAmount}
								class={errors.paymentAmount ? 'border-destructive' : ''}
							/>
							{#if errors.paymentAmount}
								<p class="text-xs text-destructive">{errors.paymentAmount}</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</ScrollArea>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={isSaving}>Cancel</Button>
			<Button onclick={handleSubmit} disabled={isSaving}>
				{#if isSaving}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Saving…
				{:else}
					<Save class="mr-2 h-4 w-4" />
					{isEdit ? 'Update' : 'Create'} Policy
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
