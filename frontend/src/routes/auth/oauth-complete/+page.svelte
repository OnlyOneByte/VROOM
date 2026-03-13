<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	// Legacy OAuth completion page — redirects to settings.
	// The provider form flow now uses returnTo=/settings/providers/new directly.
	onMount(() => {
		if (browser) {
			window.location.href = '/settings';
		}
	});
</script>

<div class="flex items-center justify-center min-h-screen">
	<p class="text-muted-foreground text-sm">Redirecting...</p>
</div>
