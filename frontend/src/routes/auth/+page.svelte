<script lang="ts">
	import { onMount } from 'svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import Wordmark from '#lib/components/common/Wordmark.svelte';
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { authApi, type PublicSignupInfo } from '#lib/services/auth-api.ts';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { authProviderIcon } from '#lib/constants/auth-providers.ts';

	const authErrorMessages: Record<string, { title: string; body: string }> = {
		invalid_state: {
			title: 'Your sign-in expired',
			body: 'It took too long to come back from the provider. Please try again.'
		},
		email_exists: {
			title: 'That email already has an account',
			body: 'Sign in with your existing account and link this provider from settings.'
		},
		provider_unavailable: {
			title: 'That sign-in option is unavailable',
			body: 'The provider is temporarily unavailable. Please try again.'
		},
		no_email: {
			title: 'We couldn’t get your email',
			body: 'Check your provider’s privacy settings, then try again.'
		},
		unknown_provider: {
			title: 'That sign-in option isn’t supported',
			body: 'Pick one of the options below.'
		},
		cancelled: {
			title: 'Sign-in was cancelled',
			body: 'The provider didn’t finish signing you in. Try again, or pick another option.'
		},
		signup_closed: {
			title: 'This server isn’t taking new accounts',
			body: 'Ask its admin if you think you should have one.'
		},
		signup_invite_required: {
			title: 'This server is invite only',
			body: 'Ask its admin for an invite, or someone who wants to share a vehicle with you. Then sign in with the email they invited.'
		},
		signup_domain_not_allowed: {
			title: 'Your email domain can’t join this server',
			body: 'This server only takes accounts from certain email domains. Try another account, or ask its admin.'
		}
	};

	let providers = $state<{ id: string; displayName: string }[]>([]);
	let isLoadingProviders = $state(true);
	let fetchError = $state<string | null>(null);
	let signingInProvider = $state<string | null>(null);
	let optionsCard = $state<HTMLElement | null>(null);
	let signupInfo = $state<PublicSignupInfo | null>(null);

	// "Get started" on the landing page links here with ?start, for someone who has no account yet.
	const isFirstVisit = $derived(page.url.searchParams.has('start'));

	const newHereLine = $derived.by(() => {
		if (!signupInfo) return null;
		const allowedEmail = signupInfo.domainRestricted ? ' with an allowed email' : '';
		const newHere = isFirstVisit ? '' : 'New here? ';
		switch (signupInfo.mode) {
			case 'open':
				return `${newHere}Signing in${allowedEmail} creates your garage.`;
			case 'approval':
				return `${newHere}Sign in${allowedEmail} to ask for an account. An admin approves it first, unless they invited you.`;
			case 'invite':
				return `${newHere}You need an invite, from this server’s admin or from someone who wants to share a vehicle with you.`;
			case 'closed':
				return 'This server isn’t taking new accounts.';
		}
	});

	const authError = $derived(page.url.searchParams.get('auth_error'));
	const authErrorMessage = $derived(authError ? (authErrorMessages[authError] ?? null) : null);
	const showNewHereLine = $derived(
		newHereLine !== null &&
			!(authError?.startsWith('signup_') && authErrorMessage) &&
			!isLoadingProviders &&
			!fetchError &&
			providers.length > 0
	);

	const authState = authStore;

	$effect(() => {
		if (!authState.isLoading && authState.isAuthenticated) {
			goto(resolve(routes.dashboard));
		}
	});

	async function loadProviders() {
		isLoadingProviders = true;
		fetchError = null;
		try {
			providers = await authApi.getProviders();
		} catch (err) {
			fetchError = userFacingErrorMessage(err);
		} finally {
			isLoadingProviders = false;
		}
	}

	async function loadSignupInfo() {
		try {
			signupInfo = await authApi.getSignupInfo();
		} catch {
			signupInfo = null;
		}
	}

	onMount(() => {
		loadProviders();
		loadSignupInfo();
	});

	function handleLogin(providerId: string) {
		signingInProvider = providerId;
		authStore.loginWith(providerId);
	}
</script>

<svelte:head>
	<title>Sign in - VROOM Car Tracker</title>
	<meta name="description" content="Sign in to track your vehicle expenses" />
</svelte:head>

<div class="min-h-screen bg-background px-[18px] pt-4 pb-10 lg:px-10">
	<Wordmark href={resolve(routes.home)} class="inline-block" />

	<div class="mx-auto mt-[8vh] grid w-full max-w-[420px] gap-3">
		{#if authErrorMessage}
			<div
				class="mb-4 grid grid-cols-[28px_1fr] items-center gap-3.5 rounded-[var(--r-lg)] bg-due-tint px-5 py-[18px]"
				role="alert"
			>
				<TriangleAlert class="size-6 text-destructive" aria-hidden="true" />
				<div class="min-w-0">
					<p class="font-[650]">{authErrorMessage.title}</p>
					<p class="text-sm">{authErrorMessage.body}</p>
				</div>
			</div>
		{/if}

		<p class="text-[13px] font-medium text-muted-foreground">
			{isFirstVisit ? 'Get started' : 'Sign in'}
		</p>
		<h1
			class="font-(family-name:--font-fig) text-5xl leading-[0.9] font-bold uppercase sm:text-[64px]"
		>
			{isFirstVisit ? 'Let’s go' : 'Welcome back'}
		</h1>
		<p class="text-muted-foreground">
			{isFirstVisit
				? 'Pick how to sign in. There’s no separate sign-up, and VROOM never sees your password.'
				: 'Use the account you signed up with. VROOM never sees your password.'}
		</p>

		<div bind:this={optionsCard} class="mt-3 grid gap-3">
			{#if isLoadingProviders}
				<Skeleton class="h-13 w-full rounded-full" />
				<Skeleton class="h-13 w-full rounded-full" />
			{:else if fetchError}
				<LoadErrorCard
					compact
					title="Couldn't load the sign-in options"
					message={fetchError}
					onRetry={loadProviders}
					onRecovered={() => focusFirstButton(optionsCard)}
				/>
			{:else if providers.length === 0}
				<p class="text-sm text-muted-foreground" role="status">
					Sign-in is currently unavailable. No providers are enabled.
				</p>
			{:else}
				{#each providers as provider (provider.id)}
					{@const IconComponent = authProviderIcon(provider.id)}
					<Button
						variant="outline"
						class="h-13 w-full text-base"
						disabled={signingInProvider !== null}
						onclick={() => handleLogin(provider.id)}
					>
						{#if signingInProvider === provider.id}
							<LoaderCircle class="size-5 motion-safe:animate-spin" aria-hidden="true" />
							Signing in...
						{:else}
							<IconComponent class="size-5" />
							Continue with {provider.displayName}
						{/if}
					</Button>
				{/each}
			{/if}
		</div>

		{#if showNewHereLine}
			<p class="mt-2 text-[13px] text-muted-foreground" data-testid="signup-mode-line">
				{newHereLine}
			</p>
		{/if}
	</div>
</div>
