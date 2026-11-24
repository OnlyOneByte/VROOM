<script lang="ts">
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
		onFix: (_provider: UserProviderInfo) => void;
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
		}
	};

	let isTesting = $state(false);
	let announcement = $state('');

	let needsAction = $derived(provider.status === 'needs_reauth' || provider.status === 'error');
	let problem = $derived(
		PROBLEM[provider.lastErrorCode ?? (provider.status === 'needs_reauth' ? 'auth' : 'unreachable')]
	);
	let checkedText = $derived(
		provider.lastCheckedAt
			? `Checked ${formatCompactRelativeTime(new Date(provider.lastCheckedAt)).toLowerCase()}`
			: 'Not checked yet'
	);

	async function testConnection() {
		if (isTesting) return;
		isTesting = true;
		announcement = 'Testing the connection…';
		try {
			const result = await providerApi.testProvider(provider.id);
			announcement = result.ok
				? `${provider.displayName} is connected.`
				: `${provider.displayName}: ${result.message}`;
			const refreshed = (await providerApi.getProviders(provider.domain)).find(
				p => p.id === provider.id
			);
			if (refreshed) onUpdated(refreshed);
		} catch (error) {
			announcement = `Couldn't test ${provider.displayName}. ${userFacingErrorMessage(error)}`;
		} finally {
			isTesting = false;
		}
	}
</script>

{#snippet testButton()}
	<Button
		variant="outline"
		class="h-10 text-foreground sm:h-9"
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

{#if needsAction}
	<Alert variant={provider.status === 'needs_reauth' ? 'warning' : 'destructive'}>
		{#if provider.status === 'needs_reauth'}
			<CircleAlert aria-hidden="true" />
		{:else}
			<CircleX aria-hidden="true" />
		{/if}
		<AlertTitle class="line-clamp-none">{problem.title}</AlertTitle>
		<AlertDescription class="text-foreground!">
			<p>{problem.detail}</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<Button class="h-10 sm:h-9" onclick={() => onFix(provider)}>
					{provider.status === 'needs_reauth' ? 'Reconnect' : 'Edit Provider'}
				</Button>
				{@render testButton()}
			</div>
		</AlertDescription>
	</Alert>
{:else if provider.status !== 'disabled'}
	<div class="flex items-center justify-between gap-2">
		<p class="text-xs text-muted-foreground">{checkedText}</p>
		{@render testButton()}
	</div>
{/if}
<p class="sr-only" role="status">{announcement}</p>
