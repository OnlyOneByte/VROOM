<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth.svelte';
	import { authApi } from '$lib/services/auth-api';
	import { routes } from '$lib/routes';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { LoaderCircle, ArrowLeft, LogIn, CircleAlert } from '@lucide/svelte';
	import GoogleLogo from '$lib/components/icons/GoogleLogo.svelte';
	import GitHubLogo from '$lib/components/icons/GitHubLogo.svelte';
	import type { Component } from 'svelte';

	const iconMap: Record<string, Component<{ class?: string }>> = {
		google: GoogleLogo,
		github: GitHubLogo
	};

	const authErrorMessages: Record<string, string> = {
		invalid_state: 'Your sign-in session expired. Please try again.',
		email_exists:
			'An account with this email already exists. Sign in with your existing account and link this provider from settings.',
		provider_unavailable: 'Sign-in provider is temporarily unavailable. Please try again.',
		no_email:
			"We couldn't retrieve your email from this provider. Please check your provider's privacy settings.",
		unknown_provider: 'This sign-in method is not supported.',
		cancelled: 'Sign-in was cancelled.'
	};

	let providers = $state<{ id: string; displayName: string }[]>([]);
	let isLoadingProviders = $state(true);
	let fetchError = $state<string | null>(null);
	let signingInProvider = $state<string | null>(null);

	const authError = $derived(page.url.searchParams.get('auth_error'));
	const authErrorMessage = $derived(authError ? (authErrorMessages[authError] ?? null) : null);

	const authState = authStore;

	// Redirect if already authenticated
	$effect(() => {
		if (!authState.isLoading && authState.isAuthenticated) {
			goto(resolve(routes.dashboard));
		}
	});

	onMount(async () => {
		try {
			providers = await authApi.getProviders();
		} catch {
			fetchError = 'Failed to load sign-in options. Please refresh the page.';
		} finally {
			isLoadingProviders = false;
		}
	});

	function handleLogin(providerId: string) {
		signingInProvider = providerId;
		authStore.loginWith(providerId);
	}
</script>

<svelte:head>
	<title>Sign In - VROOM Car Tracker</title>
	<meta name="description" content="Sign in to track your vehicle expenses" />
</svelte:head>

<div
	class="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 p-4"
>
	<div class="w-full max-w-md space-y-6">
		<!-- Back to home -->
		<Button
			variant="ghost"
			size="sm"
			class="text-muted-foreground"
			onclick={() => goto(resolve(routes.home))}
		>
			<ArrowLeft class="mr-1 h-4 w-4" />
			Back to home
		</Button>

		<!-- Logo and Title -->
		<div class="text-center space-y-2">
			<div
				class="inline-flex items-center justify-center w-20 h-20 bg-primary rounded-3xl shadow-lg mb-4"
			>
				<span class="text-5xl">🚗</span>
			</div>
			<h1 class="text-3xl font-bold tracking-tight text-foreground">Welcome back</h1>
			<p class="text-muted-foreground">Sign in to continue to your dashboard</p>
		</div>

		<!-- Auth Error Message -->
		{#if authErrorMessage}
			<div
				class="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
			>
				<CircleAlert class="h-5 w-5 text-destructive shrink-0 mt-0.5" />
				<p class="text-sm text-destructive">{authErrorMessage}</p>
			</div>
		{/if}

		<!-- Auth Card -->
		<Card.Root class="border-2">
			<Card.Content class="pt-6 space-y-4">
				{#if isLoadingProviders}
					<div class="flex items-center justify-center py-6">
						<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else if fetchError}
					<div class="text-center py-6 space-y-2">
						<CircleAlert class="h-8 w-8 text-destructive mx-auto" />
						<p class="text-sm text-destructive">{fetchError}</p>
					</div>
				{:else if providers.length === 0}
					<div class="text-center py-6">
						<p class="text-sm text-muted-foreground">
							Sign-in is currently unavailable. No providers are enabled.
						</p>
					</div>
				{:else}
					{#each providers as provider (provider.id)}
						{@const IconComponent = iconMap[provider.id]}
						<Button
							variant="outline"
							size="lg"
							class="w-full h-12 text-base"
							disabled={signingInProvider !== null}
							onclick={() => handleLogin(provider.id)}
						>
							{#if signingInProvider === provider.id}
								<LoaderCircle class="mr-2 h-5 w-5 animate-spin" />
								Signing in...
							{:else}
								{#if IconComponent}
									<IconComponent class="mr-2 h-5 w-5" />
								{:else}
									<LogIn class="mr-2 h-5 w-5" />
								{/if}
								Continue with {provider.displayName}
							{/if}
						</Button>
					{/each}
				{/if}

				<p class="text-xs text-muted-foreground text-center">
					Secure OAuth authentication. We only store your email and display name.
				</p>
			</Card.Content>
		</Card.Root>

		<!-- Footer -->
		<p class="text-center text-sm text-muted-foreground">
			No account needed · Sign in with a provider to get started
		</p>
	</div>
</div>
