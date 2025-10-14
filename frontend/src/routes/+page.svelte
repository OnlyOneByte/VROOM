<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';

	onMount(() => {
		// This page will be handled by the layout's route protection
		// Just show a loading state while auth is being determined
		const unsubscribe = authStore.subscribe(({ isAuthenticated, isLoading }) => {
			if (!isLoading) {
				if (isAuthenticated) {
					goto('/dashboard');
				} else {
					goto('/auth');
				}
			}
		});

		return unsubscribe;
	});
</script>

<svelte:head>
	<title>VROOM Car Tracker</title>
	<meta name="description" content="Track your vehicle expenses and analyze costs" />
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
	<div class="text-center">
		<div class="text-6xl mb-4">🚗</div>
		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
		<p class="text-gray-600">Loading VROOM...</p>
	</div>
</div>
