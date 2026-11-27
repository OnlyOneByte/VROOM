<script lang="ts">
	import { onMount } from 'svelte';
	import {
		initializePWA,
		promptInstall,
		pwaInstallState,
		getPlatformInfo
	} from '#lib/utils/pwa.ts';
	import { Download, CircleCheck, Share, Plus, LoaderCircle } from '@lucide/svelte';
	import HowItWorks from '#lib/components/common/how-it-works.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';

	let installing = $state(false);
	let isStandalone = $state(false);
	let canInstall = $state(false);
	let isIOS = $state(false);
	let isChromium = $state(false);

	onMount(() => {
		initializePWA();
		const info = getPlatformInfo();
		isIOS = info.isIOS;
		isChromium = info.isChromium;
		isStandalone = pwaInstallState.isStandalone;
		canInstall = pwaInstallState.canInstall;

		const checkInterval = setInterval(() => {
			canInstall = pwaInstallState.canInstall;
			isStandalone = pwaInstallState.isStandalone;
			if (canInstall || isStandalone) clearInterval(checkInterval);
		}, 500);

		const timeout = setTimeout(() => clearInterval(checkInterval), 5000);
		return () => {
			clearInterval(checkInterval);
			clearTimeout(timeout);
		};
	});

	async function handleInstall() {
		installing = true;
		const success = await promptInstall();
		if (success) {
			isStandalone = true;
			canInstall = false;
		}
		installing = false;
	}
</script>

<div class="py-3" data-testid="pwa-install">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<div class="min-w-0">
			<p class="font-medium">Install the app</p>
			{#if isStandalone}
				<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
					<CircleCheck class="h-4 w-4 shrink-0 text-chart-2" aria-hidden="true" />
					You're using the installed app.
				</p>
			{:else if canInstall}
				<p class="text-sm text-muted-foreground">Works offline from your home screen</p>
			{:else if isIOS}
				<p class="text-sm text-muted-foreground">
					In Safari, tap <span class="font-medium text-foreground">Share</span>, then
					<span class="font-medium text-foreground">Add to Home Screen</span>.
				</p>
			{:else if isChromium}
				<p class="text-sm text-muted-foreground">
					Use the install icon
					<Download class="inline h-4 w-4 align-text-bottom text-primary" aria-hidden="true" /> in the
					address bar, or <span class="font-medium text-foreground">Install VROOM</span> in the browser
					menu.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					Open VROOM in <span class="font-medium text-foreground">Chrome</span> or
					<span class="font-medium text-foreground">Edge</span> to install it.
				</p>
			{/if}
		</div>
		{#if canInstall && !isStandalone}
			<Button
				variant="outline"
				class="h-10 rounded-full"
				onclick={handleInstall}
				disabled={installing}
			>
				{#if installing}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
					Installing…
				{:else}
					Install
				{/if}
			</Button>
		{/if}
	</div>
	{#if isIOS && !isStandalone && !canInstall}
		<HowItWorks class="mt-2">
			<ol class="mt-2 space-y-2 text-sm text-foreground">
				<li>
					1. Tap the <Share class="inline h-4 w-4 text-primary align-text-bottom" />
					<span class="font-medium">Share</span> button in Safari's toolbar.
				</li>
				<li>
					2. Scroll down and tap <Plus class="inline h-4 w-4 text-primary align-text-bottom" />
					<span class="font-medium">Add to Home Screen</span>.
				</li>
				<li>3. Tap <span class="font-medium">Add</span> to confirm.</li>
			</ol>
			<p class="mt-2 text-xs text-muted-foreground">
				Other iOS browsers don't support Add to Home Screen.
			</p>
		</HowItWorks>
	{/if}
</div>
