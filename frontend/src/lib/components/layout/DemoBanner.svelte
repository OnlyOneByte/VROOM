<script lang="ts">
	import { resolve } from '$app/paths';
	import { Info, LoaderCircle } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';

	let leaving = $state(false);

	async function leave() {
		if (leaving) return;
		leaving = true;
		try {
			await authStore.logout();
			location.assign(resolve(routes.home));
		} catch (error) {
			handleErrorWithNotification(error, 'Couldn’t leave the demo');
			leaving = false;
		}
	}
</script>

<aside
	aria-label="Demo garage"
	class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-info-tint px-4 py-2 sm:px-6 lg:px-10"
	data-testid="demo-banner"
>
	<p class="flex min-w-0 items-center gap-2 text-sm">
		<Info class="size-4 shrink-0" aria-hidden="true" />
		<span>
			<strong class="font-semibold">Demo garage.</strong> Look around: changes aren’t saved.
		</span>
	</p>
	<Button variant="outline" aria-busy={leaving} onclick={leave}>
		{#if leaving}
			<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
		{/if}
		Leave the demo
	</Button>
	<span class="sr-only" role="status">{leaving ? 'Leaving the demo…' : ''}</span>
</aside>
