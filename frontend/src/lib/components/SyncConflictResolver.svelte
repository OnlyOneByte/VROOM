<script lang="ts">
	import { syncConflicts, syncManager, type SyncConflict } from '$lib/utils/sync-manager';
	import { AlertTriangle, Check, X, Merge } from 'lucide-svelte';

	let showModal = false;
	let currentConflict: SyncConflict | null = null;
	let resolving = false;

	// Subscribe to conflicts
	$: if ($syncConflicts.length > 0 && !showModal) {
		currentConflict = $syncConflicts[0] ?? null;
		showModal = true;
	}

	async function resolveConflict(resolution: 'keep_local' | 'keep_server' | 'merge') {
		if (!currentConflict) return;

		resolving = true;

		try {
			const success = await syncManager.resolveConflict(currentConflict, resolution);

			if (success) {
				// Remove resolved conflict
				const remaining = $syncConflicts.filter(c => c.id !== currentConflict!.id);
				syncConflicts.set(remaining);

				// Show next conflict or close modal
				if (remaining.length > 0) {
					currentConflict = remaining[0] ?? null;
				} else {
					closeModal();
				}
			}
		} catch (error) {
			console.error('Failed to resolve conflict:', error);
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
		return `$${amount.toFixed(2)}`;
	}
</script>

{#if showModal && currentConflict}
	<!-- Modal backdrop -->
	<div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
			<!-- Header -->
			<div class="flex items-center gap-3 p-6 border-b border-gray-200">
				<AlertTriangle class="h-6 w-6 text-orange-500" />
				<div>
					<h2 class="text-xl font-semibold text-gray-900">Sync Conflict Detected</h2>
					<p class="text-sm text-gray-600">
						{$syncConflicts.length} conflict{$syncConflicts.length !== 1 ? 's' : ''} need{$syncConflicts.length ===
						1
							? 's'
							: ''} resolution
					</p>
				</div>
			</div>

			<!-- Conflict details -->
			<div class="p-6 space-y-6">
				<div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
					<h3 class="font-medium text-orange-900 mb-2">
						{currentConflict.conflictType === 'duplicate'
							? 'Duplicate Expense'
							: 'Modified Expense'}
					</h3>
					<p class="text-sm text-orange-700">
						{#if currentConflict.conflictType === 'duplicate'}
							An expense with similar details already exists on the server.
						{:else}
							The expense has been modified both locally and on the server.
						{/if}
					</p>
				</div>

				<!-- Local vs Server comparison -->
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<!-- Local version -->
					<div class="border border-blue-200 rounded-lg p-4">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-3 h-3 bg-blue-500 rounded-full"></div>
							<h4 class="font-medium text-gray-900">Your Version (Local)</h4>
						</div>

						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-gray-600">Type:</span>
								<span class="font-medium capitalize">{currentConflict.localExpense.type}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-600">Amount:</span>
								<span class="font-medium">{formatAmount(currentConflict.localExpense.amount)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-600">Date:</span>
								<span class="font-medium">{formatDate(currentConflict.localExpense.date)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-600">Category:</span>
								<span class="font-medium capitalize">{currentConflict.localExpense.category}</span>
							</div>
							{#if currentConflict.localExpense.description}
								<div>
									<span class="text-gray-600">Description:</span>
									<p class="font-medium mt-1">{currentConflict.localExpense.description}</p>
								</div>
							{/if}
							{#if currentConflict.localExpense.gallons}
								<div class="flex justify-between">
									<span class="text-gray-600">Gallons:</span>
									<span class="font-medium">{currentConflict.localExpense.gallons}</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Server version -->
					{#if currentConflict.serverExpense}
						<div class="border border-green-200 rounded-lg p-4">
							<div class="flex items-center gap-2 mb-3">
								<div class="w-3 h-3 bg-green-500 rounded-full"></div>
								<h4 class="font-medium text-gray-900">Server Version</h4>
							</div>

							<div class="space-y-2 text-sm">
								<div class="flex justify-between">
									<span class="text-gray-600">Type:</span>
									<span class="font-medium capitalize">{currentConflict.serverExpense.type}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Amount:</span>
									<span class="font-medium"
										>{formatAmount(currentConflict.serverExpense.amount)}</span
									>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Date:</span>
									<span class="font-medium">{formatDate(currentConflict.serverExpense.date)}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-600">Category:</span>
									<span class="font-medium capitalize"
										>{currentConflict.serverExpense.category}</span
									>
								</div>
								{#if currentConflict.serverExpense.description}
									<div>
										<span class="text-gray-600">Description:</span>
										<p class="font-medium mt-1">{currentConflict.serverExpense.description}</p>
									</div>
								{/if}
								{#if currentConflict.serverExpense.gallons}
									<div class="flex justify-between">
										<span class="text-gray-600">Gallons:</span>
										<span class="font-medium">{currentConflict.serverExpense.gallons}</span>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Actions -->
			<div class="flex flex-col sm:flex-row gap-3 p-6 border-t border-gray-200">
				<button
					on:click={() => resolveConflict('keep_local')}
					disabled={resolving}
					class="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
				>
					<Check class="h-4 w-4" />
					Keep My Version
				</button>

				{#if currentConflict.serverExpense}
					<button
						on:click={() => resolveConflict('keep_server')}
						disabled={resolving}
						class="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
					>
						<Check class="h-4 w-4" />
						Keep Server Version
					</button>
				{/if}

				<button
					on:click={() => resolveConflict('merge')}
					disabled={resolving}
					class="flex-1 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
				>
					<Merge class="h-4 w-4" />
					Merge Both
				</button>

				<button
					on:click={closeModal}
					disabled={resolving}
					class="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:text-gray-400 font-medium"
				>
					<X class="h-4 w-4 inline mr-1" />
					Skip
				</button>
			</div>

			{#if resolving}
				<div class="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
					<div class="flex items-center gap-2">
						<div
							class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
						></div>
						<span class="text-gray-600">Resolving conflict...</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
