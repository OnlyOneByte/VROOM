<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';

	let { children } = $props();
	
	let authState = $state({ isAuthenticated: false, isLoading: true });

	onMount(() => {
		const unsubscribe = authStore.subscribe((state) => {
			authState = state;
			
			// Redirect to auth page if not authenticated and not loading
			if (!state.isLoading && !state.isAuthenticated) {
				goto('/auth');
			}
		});

		return unsubscribe;
	});
</script>

{#if authState.isLoading}
	<div class="min-h-screen flex items-center justify-center bg-gray-50">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
			<p class="text-gray-600">Loading...</p>
		</div>
	</div>
{:else if authState.isAuthenticated}
	{@render children?.()}
{:else}
	<!-- This will redirect to /auth, but show loading state briefly -->
	<div class="min-h-screen flex items-center justify-center bg-gray-50">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<p class="text-gray-600">Redirecting to login...</p>
		</div>
	</div>
{/if}