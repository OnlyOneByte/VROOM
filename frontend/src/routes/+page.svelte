<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { onMount } from 'svelte';
	import { LoaderCircle } from 'lucide-svelte';

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
	class="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 p-4"
>
	<div class="max-w-md w-full text-center">
		<div class="text-7xl mb-6">🚗</div>
		<LoaderCircle class="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
		<p class="text-muted-foreground">Loading...</p>
	</div>
</div>
