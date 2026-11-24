<script lang="ts">
	import { tick } from 'svelte';
	import { CircleAlert, CircleX, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatCompactRelativeTime } from '#lib/utils/formatters.ts';
	import type { ProviderHealthCode, UserProviderInfo } from '#lib/types/index.ts';

	let {
		provider,
		onFix,
		onUpdated
	}: {
		provider: UserProviderInfo;
		onFix: (_provider: UserProviderInfo, _kind: 'reconnect' | 'edit') => void;
		onUpdated: (_provider: UserProviderInfo) => void;
	} = $props();

	const PROBLEM: Record<ProviderHealthCode, { title: string; detail: string }> = {
		auth: {
			title: "The saved sign-in or key isn't accepted anymore.",
			detail: 'Reconnect to keep using this provider.'
		},
		permission: {
			title: "The provider is connected but doesn't allow access.",
			detail: 'Reconnect and allow access.'
		},
		unreachable: {
			title: "Couldn't reach the provider.",
			detail: 'Check its address and your network, then test again.'
		},
		config: {
			title: 'The settings for this provider are incomplete or invalid.',
			detail: 'Edit them, then test again.'
		},
		endpoint: {
			title: 'This server only lets providers reach public https:// addresses.',
			detail: "Change the provider's address to a public https:// one, then test again."
		}
	};

	let isTesting = $state(false);
	let announcement = $state('');
	let note = $state('');
	let noteIsFailure = $state(false);
	let root = $state<HTMLElement | null>(null);

	let needsAction = $derived(provider.status === 'needs_reauth' || provider.status === 'error');
	let problem = $derived(
		PROBLEM[provider.lastErrorCode ?? (provider.status === 'needs_reauth' ? 'auth' : 'unreachable')]
	);
	let checkedText = $derived(
		provider.lastCheckedAt
			? `Connection checked ${formatCompactRelativeTime(new Date(provider.lastCheckedAt)).toLowerCase()}`
			: 'Connection not checked yet'
	);

	async function refresh() {
		try {
			const refreshed = (await providerApi.getProviders(provider.domain)).find(
				p => p.id === provider.id
			);
			if (refreshed) onUpdated(refreshed);
		} catch {
			return;
		}
	}

	async function testConnection(event: MouseEvent) {
		if (isTesting) return;
		const hadFocus = document.activeElement === event.currentTarget;
		isTesting = true;
		note = '';
		announcement = 'Testing the connection…';
		try {
			const result = await providerApi.testProvider(provider.id);
			announcement = result.ok ? 'Connected.' : result.message;
			note = announcement;
			noteIsFailure = !result.ok;
		} catch (error) {
			announcement = `Couldn't test the connection. ${userFacingErrorMessage(error)}`;
			note = announcement;
			noteIsFailure = false;
		}
		await refresh();
		isTesting = false;
		if (hadFocus) {
			await tick();
			root?.querySelector<HTMLButtonElement>('[data-test-connection]')?.focus();
		}
	}
</script>

{#snippet testButton()}
	<Button
		variant="outline"
		class="h-10 min-w-36 text-foreground sm:h-9"
		data-test-connection
		aria-disabled={isTesting}
		aria-label="Test Connection to {provider.displayName}"
		onclick={testConnection}
	>
		{#if isTesting}
			<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
			Testing…
		{:else}
			Test Connection
		{/if}
	</Button>
{/snippet}

<div bind:this={root} class="space-y-2">
	{#if needsAction}
		<Alert role="status" variant={provider.status === 'needs_reauth' ? 'warning' : 'destructive'}>
			{#if provider.status === 'needs_reauth'}
				<CircleAlert aria-hidden="true" />
			{:else}
				<CircleX aria-hidden="true" />
			{/if}
			<AlertTitle class="line-clamp-none">{problem.title}</AlertTitle>
			<AlertDescription class="text-foreground!">
				<p>{problem.detail}</p>
				<div class="mt-2 flex flex-wrap gap-2">
					<Button
						class="h-10 sm:h-9"
						onclick={() =>
							onFix(provider, provider.status === 'needs_reauth' ? 'reconnect' : 'edit')}
					>
						{provider.status === 'needs_reauth' ? 'Reconnect' : 'Edit Provider'}
					</Button>
					{@render testButton()}
				</div>
			</AlertDescription>
		</Alert>
	{:else if provider.status !== 'disabled'}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-muted-foreground">{checkedText}</p>
			{@render testButton()}
		</div>
	{/if}
	{#if note && !(noteIsFailure && needsAction)}
		<p class="text-xs {noteIsFailure ? 'text-destructive' : 'text-muted-foreground'}">{note}</p>
	{/if}
	<p class="sr-only" role="status">{announcement}</p>
</div>
