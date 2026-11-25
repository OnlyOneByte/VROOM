<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, LoaderCircle } from '@lucide/svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import SignupModeCard from '#lib/components/settings/who-can-join/SignupModeCard.svelte';
	import ServerInvitesCard from '#lib/components/settings/who-can-join/ServerInvitesCard.svelte';
	import PendingAccountsCard from '#lib/components/settings/who-can-join/PendingAccountsCard.svelte';
	import { signupApi, type SignupSettings } from '#lib/services/signup-api.ts';
	import { routes } from '#lib/routes.ts';
	import { can } from '#lib/utils/permissions.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	let settings = $state<SignupSettings | null>(null);
	let allowed = $state<boolean | null>(null);
	let loadError = $state<string | null>(null);

	async function load() {
		loadError = null;
		try {
			allowed = can(await signupApi.serverRules(), 'server.signup.manage');
			if (allowed) settings = await signupApi.getSettings();
		} catch (e) {
			loadError = userFacingErrorMessage(e);
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Server - VROOM Car Tracker</title>
	<meta name="description" content="Choose who can join this VROOM server" />
</svelte:head>

<FormLayout>
	<div class="mb-6">
		<PageHeader title="Server" description="Who can join, invites and new accounts">
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
					aria-label="Back to Settings"
					onclick={() => goto(resolve(routes.settings))}
				>
					<ArrowLeft class="size-5" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	{#if loadError}
		<LoadErrorCard title="Couldn't load the server settings" message={loadError} onRetry={load} />
	{:else if allowed === false}
		<p class="rounded-lg border bg-card p-6 text-sm text-muted-foreground" data-testid="not-admin">
			Only a server admin can change who can join.
		</p>
	{:else if !settings}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else}
		<div class="space-y-6">
			<SignupModeCard {settings} onChange={next => (settings = next)} />
			<PendingAccountsCard />
			<ServerInvitesCard closed={settings.mode === 'closed'} />
		</div>
	{/if}
</FormLayout>
