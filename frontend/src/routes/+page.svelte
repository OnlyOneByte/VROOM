<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { onMount } from 'svelte';

	// Use automatic store subscription
	let authState = $derived($authStore);
	let showContent = $state(false);

	// Show content briefly before redirecting
	onMount(() => {
		showContent = true;
	});

	// Redirect based on auth state after showing content
	$effect(() => {
		if (!authState.isLoading && showContent) {
			const timer = setTimeout(() => {
				if (authState.isAuthenticated) {
					goto('/dashboard');
				} else {
					goto('/auth');
				}
			}, 2000);

			return () => clearTimeout(timer);
		}
		return undefined;
	});
</script>

<svelte:head>
	<title>VROOM Car Tracker</title>
	<meta name="description" content="Vehicle expense tracking with Google Drive sync" />
</svelte:head>

<div
	class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-4"
>
	<div class="max-w-md w-full text-center">
		<div class="text-7xl mb-6">🚗</div>
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
		<p class="text-gray-600">Loading...</p>
	</div>
</div>
