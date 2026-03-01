<script lang="ts">
	import { onMount } from 'svelte';
	import { initializePWA, promptInstall, pwaInstallState } from '$lib/utils/pwa';
	import { Download, X } from 'lucide-svelte';
	import { LoaderCircle } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	let showPrompt = $state(false);
	let installing = $state(false);

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
		<Card.Root>
			<Card.Content class="p-4">
				<div class="flex items-start justify-between mb-3">
					<div class="flex items-center gap-2">
						<Download size={20} class="text-primary" />
						<h3 class="font-semibold">Install VROOM</h3>
					</div>
					<button
						onclick={dismissPrompt}
						class="text-muted-foreground hover:text-foreground"
						aria-label="Dismiss install prompt"
					>
						<X size={16} />
					</button>
				</div>

				<p class="text-sm text-muted-foreground mb-4">
					Install VROOM as an app for faster access and offline functionality.
				</p>

				<div class="flex gap-2">
					<Button onclick={handleInstall} disabled={installing} class="flex-1">
						{#if installing}
							<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							Installing...
						{:else}
							<Download size={16} class="mr-2" />
							Install
						{/if}
					</Button>

					<Button variant="ghost" onclick={dismissPrompt}>Later</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
