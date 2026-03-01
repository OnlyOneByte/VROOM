<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';

	let { children } = $props();

	let authState = $derived($authStore);

	$effect(() => {
		if (!authState.isLoading && !authState.isAuthenticated) {
			goto('/auth');
		}
	});
</script>

{#if authState.isLoading}
	<div class="min-h-screen flex items-center justify-center bg-background">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
			<p class="text-muted-foreground">Loading...</p>
		</div>
	</div>
{:else if authState.isAuthenticated}
	{@render children?.()}
{:else}
	<div class="min-h-screen flex items-center justify-center bg-background">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<p class="text-muted-foreground">Redirecting to login...</p>
		</div>
	</div>
{/if}
