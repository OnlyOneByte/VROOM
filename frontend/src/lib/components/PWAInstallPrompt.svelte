<script lang="ts">
	import { onMount } from 'svelte';
	import { initializePWA, promptInstall, pwaInstallState } from '$lib/utils/pwa';
	import { Download, X } from 'lucide-svelte';

	let showPrompt = false;
	let installing = false;

	onMount(() => {
		initializePWA();

		// Check periodically if install prompt is available
		const checkInterval = setInterval(() => {
			if (pwaInstallState.canInstall && !pwaInstallState.isInstalled) {
				showPrompt = true;
				clearInterval(checkInterval);
			}
		}, 1000);

		// Clean up interval after 10 seconds
		setTimeout(() => clearInterval(checkInterval), 10000);

		return () => clearInterval(checkInterval);
	});

	async function handleInstall() {
		installing = true;
		const success = await promptInstall();

		if (success) {
			showPrompt = false;
		}

		installing = false;
	}

	function dismissPrompt() {
		showPrompt = false;
	}
</script>

{#if showPrompt && !pwaInstallState.isInstalled}
	<div class="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50">
		<div
			class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4"
		>
			<div class="flex items-start justify-between mb-3">
				<div class="flex items-center gap-2">
					<Download size={20} class="text-blue-500" />
					<h3 class="font-semibold text-gray-900 dark:text-white">Install VROOM</h3>
				</div>
				<button
					on:click={dismissPrompt}
					class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<X size={16} />
				</button>
			</div>

			<p class="text-sm text-gray-600 dark:text-gray-300 mb-4">
				Install VROOM as an app for faster access and offline functionality.
			</p>

			<div class="flex gap-2">
				<button
					on:click={handleInstall}
					disabled={installing}
					class="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
				>
					{#if installing}
						<div
							class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
						></div>
						Installing...
					{:else}
						<Download size={16} />
						Install
					{/if}
				</button>

				<button
					on:click={dismissPrompt}
					class="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white text-sm font-medium"
				>
					Later
				</button>
			</div>
		</div>
	</div>
{/if}
