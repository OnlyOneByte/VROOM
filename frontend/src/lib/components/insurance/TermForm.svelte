<script lang="ts">
	import { LoaderCircle, Save } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { prefillFromPreviousTerm } from '$lib/utils/insurance';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import SplitConfigEditor from '$lib/components/expenses/SplitConfigEditor.svelte';
	import type {
		PolicyTerm,
		PolicyDetails,
		FinanceDetails,
		Vehicle,
		TermCoverageRow
	} from '$lib/types';

	interface Props {
		open: boolean;
		policyId: string;
		term?: PolicyTerm | null;
		previousTerm?: PolicyTerm | null;
		vehicles?: Vehicle[];
		termVehicleCoverage?: TermCoverageRow[];
		onSuccess: () => void;
	}

	let {
		open = $bindable(false),
		policyId,
		term = null,
		previousTerm = null,
		vehicles = [],
		termVehicleCoverage = [],
		onSuccess
	}: Props = $props();

	let isEdit = $derived(!!term);
	let isSaving = $state(false);

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

	interface TermFormErrors {
		startDate?: string;
		endDate?: string;
		deductibleAmount?: string;
		coverageLimit?: string;
		totalCost?: string;
		monthlyCost?: string;
		paymentAmount?: string;
	}
	let errors = $state<TermFormErrors>({});

	// Vehicle coverage state
	let selectedVehicleIds = $state<string[]>([]);
	let splitMethod = $state<'even' | 'absolute' | 'percentage'>('even');
	let splitAllocations = $state<Array<{ vehicleId: string; amount?: number; percentage?: number }>>(
		[]
	);

	let splitVehicles = $derived(vehicles.filter(v => selectedVehicleIds.includes(v.id)));
	let parsedTotalCost = $derived(parseFloat(totalCost) || 0);
	let showSplitEditor = $derived(parsedTotalCost > 0 && selectedVehicleIds.length >= 2);

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

	// Populate form fields from a term source
	function populateFromTerm(source: PolicyTerm) {
		policyNumber = source.policyDetails.policyNumber ?? '';
		coverageDescription = source.policyDetails.coverageDescription ?? '';
		deductibleAmount = source.policyDetails.deductibleAmount?.toString() ?? '';
		coverageLimit = source.policyDetails.coverageLimit?.toString() ?? '';
		agentName = source.policyDetails.agentName ?? '';
		agentPhone = source.policyDetails.agentPhone ?? '';
		agentEmail = source.policyDetails.agentEmail ?? '';
		totalCost = source.financeDetails.totalCost?.toString() ?? '';
		monthlyCost = source.financeDetails.monthlyCost?.toString() ?? '';
		premiumFrequency = source.financeDetails.premiumFrequency ?? '';
		paymentAmount = source.financeDetails.paymentAmount?.toString() ?? '';
	}

	function resetFormFields() {
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
	}

	// Populate form fields when dialog opens.
	// Reads: open, term, previousTerm (dependencies).
	// Writes to $state fields are NOT tracked as dependencies.
	$effect(() => {
		if (!open) return;

		errors = {};
		isSaving = false;
		splitMethod = 'even';
		splitAllocations = [];

		if (term) {
			startDate = term.startDate.split('T')[0] ?? term.startDate;
			endDate = term.endDate.split('T')[0] ?? term.endDate;
			populateFromTerm(term);
			// Populate vehicle coverage from termVehicleCoverage
			const termCoverage = termVehicleCoverage.filter(tc => tc.termId === term.id);
			selectedVehicleIds = termCoverage.map(tc => tc.vehicleId);
		} else if (previousTerm) {
			resetFormFields();
			const prefill = prefillFromPreviousTerm(previousTerm);
			populateFromTerm({
				...previousTerm,
				policyDetails: prefill.policyDetails,
				financeDetails: prefill.financeDetails
			});
			// Dates should be blank for renewal — user enters new dates
			startDate = '';
			endDate = '';
			// Carry over vehicle coverage from previous term
			const prevCoverage = termVehicleCoverage.filter(tc => tc.termId === previousTerm.id);
			selectedVehicleIds = prevCoverage.map(tc => tc.vehicleId);
		} else {
			resetFormFields();
			selectedVehicleIds = [];
		}
	});

	function validate(): boolean {
		const newErrors: TermFormErrors = {};

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

		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	function buildPolicyDetails(): PolicyDetails {
		const details: PolicyDetails = {};
		if (policyNumber.trim()) details.policyNumber = policyNumber.trim();
		if (coverageDescription.trim()) details.coverageDescription = coverageDescription.trim();
		if (deductibleAmount) details.deductibleAmount = Number(deductibleAmount);
		if (coverageLimit) details.coverageLimit = Number(coverageLimit);
		if (agentName.trim()) details.agentName = agentName.trim();
		if (agentPhone.trim()) details.agentPhone = agentPhone.trim();
		if (agentEmail.trim()) details.agentEmail = agentEmail.trim();
		return details;
	}

	function buildFinanceDetails(): FinanceDetails {
		const details: FinanceDetails = {};
		if (totalCost) details.totalCost = Number(totalCost);
		if (premiumFrequency) details.premiumFrequency = premiumFrequency;
		return details;
	}

	async function handleSubmit() {
		if (!validate()) return;

		isSaving = true;
		try {
			const vehicleCoverage = {
				vehicleIds: selectedVehicleIds,
				splitMethod: splitMethod !== 'even' ? splitMethod : undefined,
				allocations: splitMethod !== 'even' ? splitAllocations : undefined
			};

			if (isEdit && term) {
				await insuranceApi.updateTerm(policyId, term.id, {
					startDate,
					endDate,
					policyDetails: buildPolicyDetails(),
					financeDetails: buildFinanceDetails(),
					vehicleCoverage
				});
			} else {
				await insuranceApi.addTerm(policyId, {
					id: crypto.randomUUID(),
					startDate,
					endDate,
					policyDetails: buildPolicyDetails(),
					financeDetails: buildFinanceDetails(),
					vehicleCoverage
				});
			}
			onSuccess();
		} catch (err) {
			handleErrorWithNotification(err, isEdit ? 'Failed to update term' : 'Failed to add term');
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg max-h-[90vh]">
		<Dialog.Header>
			<Dialog.Title>
				{#if isEdit}Edit Term{:else if previousTerm}Renew Term{:else}Add Term{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if previousTerm && !isEdit}
					Pre-filled from the previous term. Update dates and details as needed.
				{:else}
					Enter the term coverage period and details.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<ScrollArea class="max-h-[60vh] pr-4">
			<div class="space-y-4 py-2">
				<!-- Dates -->
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="term-start-date">Start Date *</Label>
						<Input
							id="term-start-date"
							type="date"
							bind:value={startDate}
							class={errors.startDate ? 'border-destructive' : ''}
						/>
						{#if errors.startDate}
							<p class="text-xs text-destructive">{errors.startDate}</p>
						{/if}
					</div>
					<div class="space-y-2">
						<Label for="term-end-date">End Date *</Label>
						<Input
							id="term-end-date"
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
						<Label for="tf-policy-number">Policy Number</Label>
						<Input id="tf-policy-number" bind:value={policyNumber} />
					</div>
					<div class="space-y-2">
						<Label for="tf-deductible">Deductible ($)</Label>
						<Input
							id="tf-deductible"
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
					<Label for="tf-coverage-desc">Coverage Description</Label>
					<Textarea id="tf-coverage-desc" bind:value={coverageDescription} rows={2} />
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="tf-coverage-limit">Coverage Limit ($)</Label>
						<Input
							id="tf-coverage-limit"
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
						<Label for="tf-agent-name">Agent Name</Label>
						<Input id="tf-agent-name" bind:value={agentName} />
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="tf-agent-phone">Agent Phone</Label>
						<Input id="tf-agent-phone" type="tel" bind:value={agentPhone} />
					</div>
					<div class="space-y-2">
						<Label for="tf-agent-email">Agent Email</Label>
						<Input id="tf-agent-email" type="email" bind:value={agentEmail} />
					</div>
				</div>

				<Separator />
				<h4 class="text-sm font-medium text-foreground">Vehicle Coverage</h4>

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
					<p class="text-sm text-muted-foreground">No vehicles available.</p>
				{/if}

				{#if showSplitEditor}
					<SplitConfigEditor
						vehicles={splitVehicles}
						totalAmount={parsedTotalCost}
						{splitMethod}
						allocations={splitAllocations}
						onMethodChange={handleSplitMethodChange}
						onAllocationsChange={handleAllocationsChange}
					/>
				{/if}

				<Separator />
				<h4 class="text-sm font-medium text-foreground">Finance Details</h4>

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-2">
						<Label for="tf-total-cost">Total Cost ($)</Label>
						<Input
							id="tf-total-cost"
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
						<Label for="tf-frequency">Premium Frequency</Label>
						<Select.Root
							type="single"
							value={premiumFrequency}
							onValueChange={v => {
								premiumFrequency = v ?? '';
							}}
						>
							<Select.Trigger id="tf-frequency" class="w-full">
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
					{isEdit ? 'Update' : 'Add'} Term
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
