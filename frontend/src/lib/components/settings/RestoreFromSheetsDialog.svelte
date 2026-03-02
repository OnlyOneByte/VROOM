<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { LoaderCircle } from 'lucide-svelte';

	interface Props {
		open: boolean;
		isRestoring: boolean;
		restoreMode: 'preview' | 'replace' | 'merge';
		restorePreview: Record<string, number | undefined> | null;
		restoreConflicts: Array<{ table?: string; id?: string; field?: string }>;
		onRestore: () => void;
		onPreview: () => void;
	}

	let {
		open = $bindable(),
		isRestoring,
		restoreMode = $bindable(),
		restorePreview,
		restoreConflicts,
		onRestore,
		onPreview
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Restore from Google Sheets</Dialog.Title>
			<Dialog.Description>Import your data back from Google Sheets into the app</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			{#if !restorePreview && !isRestoring}
				<div class="space-y-2">
					<p class="text-sm text-muted-foreground">
						This will read your data from the Google Sheets spreadsheet that was created during
						backup. Click "Preview" to see what will be imported before restoring.
					</p>
					<Button variant="outline" onclick={onPreview} class="w-full">Preview Import</Button>
				</div>
			{/if}

			{#if isRestoring && !restorePreview}
				<div class="flex items-center gap-2 text-sm text-primary">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					<span>Loading preview from Google Sheets...</span>
				</div>
			{/if}

			<!-- Restore Mode -->
			{#if restorePreview}
				<div class="space-y-3">
					<Label>Restore Mode</Label>
					<RadioGroup.Root bind:value={restoreMode}>
						<div class="flex items-center space-x-2">
							<RadioGroup.Item value="replace" id="sheets-mode-replace" />
							<Label for="sheets-mode-replace" class="font-normal cursor-pointer">
								<div>
									<div class="font-medium">Replace All</div>
									<div class="text-sm text-muted-foreground">
										Delete all existing data and import from Google Sheets
									</div>
								</div>
							</Label>
						</div>
						<div class="flex items-center space-x-2 opacity-50">
							<RadioGroup.Item value="merge" id="sheets-mode-merge" disabled />
							<Label for="sheets-mode-merge" class="font-normal cursor-not-allowed">
								<div>
									<div class="font-medium">Merge (Coming Soon)</div>
									<div class="text-sm text-muted-foreground">
										Merge Google Sheets data with existing data — currently unavailable
									</div>
								</div>
							</Label>
						</div>
					</RadioGroup.Root>
				</div>
			{/if}

			<!-- Preview Results -->
			{#if restorePreview}
				<div class="border rounded-lg p-4 bg-muted">
					<h4 class="font-medium mb-3">Import Summary</h4>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span>Vehicles:</span>
							<span class="font-medium">{restorePreview['vehicles'] || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Expenses:</span>
							<span class="font-medium">{restorePreview['expenses'] || 0}</span>
						</div>
						{#if restorePreview['financing']}
							<div class="flex justify-between">
								<span>Financing:</span>
								<span class="font-medium">{restorePreview['financing']}</span>
							</div>
						{/if}
						{#if restorePreview['insurance']}
							<div class="flex justify-between">
								<span>Insurance Policies:</span>
								<span class="font-medium">{restorePreview['insurance']}</span>
							</div>
						{/if}
						{#if restorePreview['insurancePolicyVehicles']}
							<div class="flex justify-between">
								<span>Policy-Vehicle Links:</span>
								<span class="font-medium">{restorePreview['insurancePolicyVehicles']}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Conflicts Warning -->
			{#if restoreConflicts.length > 0}
				<div class="border border-destructive rounded-lg p-4 bg-destructive/10">
					<h4 class="font-medium text-destructive mb-2">
						{restoreConflicts.length} Potential Conflict{restoreConflicts.length > 1 ? 's' : ''}
					</h4>
					<p class="text-sm text-muted-foreground">
						Some records may conflict with existing data. Using "Replace All" will overwrite them.
					</p>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{#if restorePreview}
				<Button variant="destructive" onclick={onRestore} disabled={isRestoring}>
					{#if isRestoring}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Restoring...
					{:else}
						Restore Data
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
