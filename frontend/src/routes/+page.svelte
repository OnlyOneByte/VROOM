<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';

	// Use automatic store subscription
	let authState = $derived($authStore);

	// Redirect based on auth state
	$effect(() => {
		if (!authState.isLoading) {
			if (authState.isAuthenticated) {
				goto('/vehicles');
			} else {
				goto('/auth');
			}
		}
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
