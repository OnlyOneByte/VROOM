<script lang="ts">
	import { onMount } from 'svelte';
	import { initializePWA, promptInstall, pwaInstallState, getPlatformInfo } from '$lib/utils/pwa';
	import { Download, CircleCheck, Share, Smartphone, Monitor, Plus, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

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

		// Poll briefly for the beforeinstallprompt event
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
		<CardDescription
			>Use VROOM as a standalone app for faster access and offline support</CardDescription
		>
	</CardHeader>
	<CardContent>
		{#if isStandalone}
			<!-- Already installed / running as PWA -->
			<div class="flex items-center gap-3 rounded-lg bg-chart-2/10 p-4">
				<CircleCheck class="h-5 w-5 text-chart-2 shrink-0" />
				<p class="text-sm text-foreground">
					You're using VROOM as an installed app. You're all set.
				</p>
			</div>
		{:else if canInstall}
			<!-- Android / Desktop Chrome/Edge — native install prompt available -->
			<div class="space-y-4">
				<p class="text-sm text-muted-foreground">
					Install VROOM on your device for a native app experience with offline support and faster
					loading.
				</p>
				<Button onclick={handleInstall} disabled={installing}>
					{#if installing}
						<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
						Installing…
					{:else}
						<Download class="h-4 w-4 mr-2" />
						Install VROOM
					{/if}
				</Button>
			</div>
		{:else if isIOS}
			<!-- iOS — manual Add to Home Screen instructions -->
			<div class="space-y-4">
				<p class="text-sm text-muted-foreground">
					To install VROOM on your iPhone or iPad, use Safari's Add to Home Screen feature:
				</p>
				<ol class="space-y-3 text-sm">
					<li class="flex items-start gap-3">
						<span
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
							>1</span
						>
						<span class="text-foreground">
							Tap the <Share class="inline h-4 w-4 text-primary align-text-bottom" />
							<span class="font-medium">Share</span> button in Safari's toolbar
						</span>
					</li>
					<li class="flex items-start gap-3">
						<span
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
							>2</span
						>
						<span class="text-foreground">
							Scroll down and tap <Plus class="inline h-4 w-4 text-primary align-text-bottom" />
							<span class="font-medium">Add to Home Screen</span>
						</span>
					</li>
					<li class="flex items-start gap-3">
						<span
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
							>3</span
						>
						<span class="text-foreground">
							Tap <span class="font-medium">Add</span> to confirm
						</span>
					</li>
				</ol>
				<p class="text-xs text-muted-foreground">
					Make sure you're using Safari — other iOS browsers don't support Add to Home Screen.
				</p>
			</div>
		{:else if isChromium}
			<!-- Chrome/Edge but beforeinstallprompt hasn't fired -->
			<div class="space-y-4">
				<p class="text-sm text-muted-foreground">
					Install VROOM on your device for a native app experience with offline support and faster
					loading.
				</p>
				<p class="text-sm text-muted-foreground">
					Look for the install icon
					<Download class="inline h-4 w-4 text-primary align-text-bottom" /> in your browser's address
					bar, or open the browser menu and select
					<span class="font-medium text-foreground">Install VROOM</span>.
				</p>
			</div>
		{:else}
			<!-- Non-Chromium desktop browser (Firefox, Safari macOS, etc.) -->
			<div class="space-y-3">
				<div class="flex items-start gap-3 rounded-lg bg-muted p-4">
					<Monitor class="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
					<div class="text-sm">
						<p class="text-foreground">
							For the best experience, open VROOM in <span class="font-medium">Chrome</span> or
							<span class="font-medium">Edge</span> to install it as a desktop app.
						</p>
						<p class="text-muted-foreground mt-1">
							You'll get a dedicated window, offline access, and faster loading.
						</p>
					</div>
				</div>
			</div>
		{/if}
	</CardContent>
</Card>
