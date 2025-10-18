<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.js';

	let status = $state('processing');
	let error = $state('');

	// Use automatic store subscription
	let authState = $derived($authStore);

	onMount(async () => {
		try {
			// Get the current URL parameters
			const urlParams = new URLSearchParams($page.url.search);
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

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
	<div class="max-w-md w-full space-y-8">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<h2 class="text-3xl font-bold text-gray-900 mb-2">VROOM Car Tracker</h2>
		</div>

		<div class="card text-center">
			{#if status === 'processing'}
				<div class="space-y-4">
					<div
						class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"
					></div>
					<h3 class="text-lg font-medium text-gray-900">Completing sign in...</h3>
					<p class="text-gray-600">Please wait while we set up your account</p>
				</div>
			{:else if status === 'success'}
				<div class="space-y-4">
					<div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mx-auto">
						<svg
							class="w-5 h-5 text-green-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-green-900">Sign in successful!</h3>
					<p class="text-green-700">Redirecting to your dashboard...</p>
				</div>
			{:else if status === 'error'}
				<div class="space-y-4">
					<div class="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mx-auto">
						<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							></path>
						</svg>
					</div>
					<h3 class="text-lg font-medium text-red-900">Sign in failed</h3>
					<p class="text-red-700 text-sm">
						{error}
					</p>
					<button type="button" class="btn btn-primary" onclick={retryAuth}> Try Again </button>
				</div>
			{/if}
		</div>
	</div>
</div>
