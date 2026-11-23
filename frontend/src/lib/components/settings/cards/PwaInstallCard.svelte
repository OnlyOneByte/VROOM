<script lang="ts">
	import { onMount } from 'svelte';
	import {
		initializePWA,
		promptInstall,
		pwaInstallState,
		getPlatformInfo
	} from '#lib/utils/pwa.ts';
	import { Download, CircleCheck, Share, Smartphone, Plus, LoaderCircle } from '@lucide/svelte';
	import HowItWorks from '#lib/components/common/how-it-works.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';

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

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<Smartphone class="h-5 w-5" />
			Install App
		</CardTitle>
		<CardDescription>Use VROOM like an app, with offline access.</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isStandalone}
			<p class="flex items-center gap-2 text-sm text-foreground">
				<CircleCheck class="h-4 w-4 text-chart-2 shrink-0" />
				You're using the installed app.
			</p>
		{:else if canInstall}
			<Button onclick={handleInstall} disabled={installing}>
				{#if installing}
					<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
					Installing…
				{:else}
					<Download class="h-4 w-4 mr-2" />
					Install VROOM
				{/if}
			</Button>
		{:else if isIOS}
			<p class="text-sm text-muted-foreground">
				In Safari, tap <span class="font-medium text-foreground">Share</span>, then
				<span class="font-medium text-foreground">Add to Home Screen</span>.
			</p>
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
		{:else if isChromium}
			<p class="text-sm text-muted-foreground">
				Use the install icon
				<Download class="inline h-4 w-4 text-primary align-text-bottom" /> in the address bar, or
				<span class="font-medium text-foreground">Install VROOM</span> in the browser menu.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground">
				Open VROOM in <span class="font-medium text-foreground">Chrome</span> or
				<span class="font-medium text-foreground">Edge</span> to install it.
			</p>
		{/if}
	</CardContent>
</Card>
