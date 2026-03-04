<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LoaderCircle, Check, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';

	let status = $state('processing');
	let error = $state('');

	// Use automatic store subscription
	const authState = authStore;

	onMount(async () => {
		try {
			// Get the current URL parameters
			const urlParams = new URLSearchParams(page.url.search);
			const code = urlParams.get('code');

			const errorParam = urlParams.get('error');

			if (errorParam) {
				throw new Error(`OAuth error: ${errorParam}`);
			}

			if (!code) {
				throw new Error('No authorization code received');
			}

			// The backend should handle the OAuth callback and set the session
			// We just need to check if we're now authenticated
			await authStore.initialize();
		} catch (err) {
			status = 'error';
			error = err instanceof Error ? err.message : 'Authentication failed';
		}
	});

	// Check auth state and redirect
	$effect(() => {
		if (!authState.isLoading) {
			if (authState.isAuthenticated) {
				status = 'success';
				setTimeout(() => {
					goto('/dashboard');
				}, 1000);
			} else if (status === 'processing') {
				status = 'error';
				error = authState.error || 'Authentication failed';
			}
		}
	});

	function retryAuth() {
		goto('/auth');
	}
</script>

<svelte:head>
	<title>Authenticating - VROOM Car Tracker</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
	<div class="max-w-md w-full space-y-8">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<h2 class="text-3xl font-bold text-foreground mb-2">VROOM Car Tracker</h2>
		</div>

		<div class="rounded-lg border bg-card p-6 text-center">
			{#if status === 'processing'}
				<div class="space-y-4">
					<LoaderCircle class="h-8 w-8 animate-spin text-primary mx-auto" />
					<h3 class="text-lg font-medium text-foreground">Completing sign in...</h3>
					<p class="text-muted-foreground">Please wait while we set up your account</p>
				</div>
			{:else if status === 'success'}
				<div class="space-y-4">
					<div class="w-8 h-8 bg-chart-2/10 rounded-full flex items-center justify-center mx-auto">
						<Check class="w-5 h-5 text-chart-2" />
					</div>
					<h3 class="text-lg font-medium text-foreground">Sign in successful!</h3>
					<p class="text-muted-foreground">Redirecting to your dashboard...</p>
				</div>
			{:else if status === 'error'}
				<div class="space-y-4">
					<div
						class="w-8 h-8 bg-destructive/10 rounded-full flex items-center justify-center mx-auto"
					>
						<X class="w-5 h-5 text-destructive" />
					</div>
					<h3 class="text-lg font-medium text-foreground">Sign in failed</h3>
					<p class="text-destructive text-sm">
						{error}
					</p>
					<Button onclick={retryAuth}>Try Again</Button>
				</div>
			{/if}
		</div>
	</div>
</div>
