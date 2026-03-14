<script lang="ts">
	import { syncConflicts, syncManager, type SyncConflict } from '$lib/utils/sync/sync-manager';
	import { TriangleAlert, Check, X, Merge, LoaderCircle } from '@lucide/svelte';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';

	let showModal = $state(false);
	let currentConflict = $state<SyncConflict | null>(null);
	let resolving = $state(false);

	$effect(() => {
		if (syncConflicts.current.length > 0 && !showModal) {
			currentConflict = syncConflicts.current[0] ?? null;
			showModal = true;
		}
	});

	async function resolveConflict(resolution: 'keep_local' | 'keep_server' | 'merge') {
		if (!currentConflict) return;

		resolving = true;

		try {
			const success = await syncManager.resolveConflict(currentConflict, resolution);

			if (success) {
				const remaining = syncConflicts.current.filter(c => c.id !== currentConflict!.id);
				syncConflicts.current = remaining;

				if (remaining.length > 0) {
					currentConflict = remaining[0] ?? null;
				} else {
					closeModal();
				}
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to resolve conflict:', error);
		} finally {
			resolving = false;
		}
	}

	function closeModal() {
		showModal = false;
		currentConflict = null;
	}

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString();
	}

	function formatAmount(amount: number): string {
		return `${amount.toFixed(2)}`;
	}
</script>

<Dialog bind:open={showModal}>
	<DialogContent class="max-w-2xl">
		{#if currentConflict}
			<DialogHeader>
				<div class="flex items-center gap-3">
					<TriangleAlert class="h-6 w-6 text-chart-5" />
					<div>
						<DialogTitle>Sync Conflict Detected</DialogTitle>
						<DialogDescription>
							{syncConflicts.current.length} conflict{syncConflicts.current.length !== 1 ? 's' : ''}
							need{syncConflicts.current.length === 1 ? 's' : ''} resolution
						</DialogDescription>
					</div>
				</div>
			</DialogHeader>

			<ScrollArea class="max-h-[60vh]">
				<div class="space-y-6 pr-4">
					<Alert>
						<TriangleAlert class="h-4 w-4" />
						<AlertTitle>
							{currentConflict.conflictType === 'duplicate'
								? 'Duplicate Expense'
								: 'Modified Expense'}
						</AlertTitle>
						<AlertDescription>
							{#if currentConflict.conflictType === 'duplicate'}
								An expense with similar details already exists on the server.
							{:else}
								The expense has been modified both locally and on the server.
							{/if}
						</AlertDescription>
					</Alert>

					<!-- Local vs Server comparison -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<!-- Local version -->
						<div class="border border-primary/30 rounded-lg p-4">
							<div class="flex items-center gap-2 mb-3">
								<div class="w-3 h-3 bg-primary rounded-full"></div>
								<h4 class="font-medium">Your Version (Local)</h4>
							</div>

							<div class="space-y-2 text-sm">
								<div class="flex justify-between">
									<span class="text-muted-foreground">Category:</span>
									<span class="font-medium capitalize">{currentConflict.localExpense.category}</span
									>
								</div>
								{#if currentConflict.localExpense.tags && currentConflict.localExpense.tags.length > 0}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Tags:</span>
										<span class="font-medium">{currentConflict.localExpense.tags.join(', ')}</span>
									</div>
								{/if}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Amount:</span>
									<span class="font-medium"
										>{formatAmount(currentConflict.localExpense.amount)}</span
									>
								</div>
								<div class="flex justify-between">
									<span class="text-muted-foreground">Date:</span>
									<span class="font-medium">{formatDate(currentConflict.localExpense.date)}</span>
								</div>
								{#if currentConflict.localExpense.description}
									<div>
										<span class="text-muted-foreground">Description:</span>
										<p class="font-medium mt-1">{currentConflict.localExpense.description}</p>
									</div>
								{/if}
								{#if currentConflict.localExpense.volume}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Volume:</span>
										<span class="font-medium">{currentConflict.localExpense.volume}</span>
									</div>
								{/if}
								{#if currentConflict.localExpense.charge}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Charge:</span>
										<span class="font-medium">{currentConflict.localExpense.charge}</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- Server version -->
						{#if currentConflict.serverExpense}
							<div class="border border-chart-2/30 rounded-lg p-4">
								<div class="flex items-center gap-2 mb-3">
									<div class="w-3 h-3 bg-chart-2 rounded-full"></div>
									<h4 class="font-medium">Server Version</h4>
								</div>

								<div class="space-y-2 text-sm">
									<div class="flex justify-between">
										<span class="text-muted-foreground">Category:</span>
										<span class="font-medium capitalize"
											>{currentConflict.serverExpense.category}</span
										>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Tags:</span>
										<span class="font-medium">{currentConflict.serverExpense.tags.join(', ')}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Amount:</span>
										<span class="font-medium"
											>{formatAmount(currentConflict.serverExpense.amount)}</span
										>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Date:</span>
										<span class="font-medium">{formatDate(currentConflict.serverExpense.date)}</span
										>
									</div>
									{#if currentConflict.serverExpense.description}
										<div>
											<span class="text-muted-foreground">Description:</span>
											<p class="font-medium mt-1">{currentConflict.serverExpense.description}</p>
										</div>
									{/if}
									{#if currentConflict.serverExpense.volume}
										<div class="flex justify-between">
											<span class="text-muted-foreground">Volume:</span>
											<span class="font-medium">{currentConflict.serverExpense.volume}</span>
										</div>
									{/if}
									{#if currentConflict.serverExpense.charge}
										<div class="flex justify-between">
											<span class="text-muted-foreground">Charge:</span>
											<span class="font-medium">{currentConflict.serverExpense.charge}</span>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</ScrollArea>

			<!-- Actions -->
			<div class="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
				<Button onclick={() => resolveConflict('keep_local')} disabled={resolving} class="flex-1">
					<Check class="h-4 w-4 mr-2" />
					Keep My Version
				</Button>

				{#if currentConflict.serverExpense}
					<Button
						variant="secondary"
						onclick={() => resolveConflict('keep_server')}
						disabled={resolving}
						class="flex-1"
					>
						<Check class="h-4 w-4 mr-2" />
						Keep Server Version
					</Button>
				{/if}

				<Button
					variant="outline"
					onclick={() => resolveConflict('merge')}
					disabled={resolving}
					class="flex-1"
				>
					<Merge class="h-4 w-4 mr-2" />
					Merge Both
				</Button>

				<Button variant="ghost" onclick={closeModal} disabled={resolving}>
					<X class="h-4 w-4 mr-1" />
					Skip
				</Button>
			</div>

			{#if resolving}
				<div class="absolute inset-0 bg-background/75 flex items-center justify-center rounded-lg">
					<div class="flex items-center gap-2">
						<LoaderCircle class="w-5 h-5 animate-spin text-primary" />
						<span class="text-muted-foreground">Resolving conflict...</span>
					</div>
				</div>
			{/if}
		{/if}
	</DialogContent>
</Dialog>
