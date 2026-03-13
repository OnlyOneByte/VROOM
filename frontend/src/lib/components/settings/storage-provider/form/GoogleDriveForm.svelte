<script lang="ts">
	import { browser } from '$app/environment';
	import { Cloud, CircleCheck, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	let {
		connectedEmail = '',
		onStartOAuth
	}: {
		connectedEmail?: string;
		onStartOAuth?: () => void;
	} = $props();

	let isRedirecting = $state(false);

	function handleConnectGoogle() {
		if (!browser) return;
		isRedirecting = true;
		onStartOAuth?.();
	}
</script>

<div class="space-y-4">
	{#if connectedEmail}
		<div class="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
			<div class="flex items-center gap-3 min-w-0">
				<CircleCheck class="h-5 w-5 text-chart-2 shrink-0" />
				<div class="min-w-0">
					<p class="text-sm font-medium">Google Account Connected</p>
					<p class="text-sm text-muted-foreground truncate">{connectedEmail}</p>
				</div>
			</div>
			<Button
				variant="ghost"
				size="sm"
				class="shrink-0"
				onclick={handleConnectGoogle}
				disabled={isRedirecting}
			>
				{#if isRedirecting}
					<LoaderCircle class="h-4 w-4 animate-spin" />
				{:else}
					Change
				{/if}
			</Button>
		</div>
	{:else if isRedirecting}
		<div class="flex items-center gap-3 rounded-lg border border-border p-4">
			<LoaderCircle class="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
			<div>
				<p class="text-sm font-medium">Redirecting to Google...</p>
				<p class="text-sm text-muted-foreground">You'll be brought back here after sign-in</p>
			</div>
		</div>
	{:else}
		<div class="rounded-lg border border-border p-4 text-center">
			<Cloud class="h-8 w-8 text-muted-foreground mx-auto mb-2" />
			<p class="text-sm text-muted-foreground mb-3">
				Connect your Google account to use Google Drive for photo storage
			</p>
			<Button variant="outline" onclick={handleConnectGoogle}>
				<svg class="h-4 w-4 mr-2" viewBox="0 0 24 24">
					<path
						d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
						fill="#4285F4"
					/>
					<path
						d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						fill="#34A853"
					/>
					<path
						d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						fill="#FBBC05"
					/>
					<path
						d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						fill="#EA4335"
					/>
				</svg>
				Connect Google Account
			</Button>
		</div>
	{/if}
</div>
