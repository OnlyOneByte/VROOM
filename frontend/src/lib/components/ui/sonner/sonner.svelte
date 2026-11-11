<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte';
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

	let { ...restProps }: SonnerProps = $props();
</script>

<!--
	`theme` tracks the app's light/dark preference rather than a literal: sonner renders its own
	surface from `data-sonner-theme`, so a hardcoded value leaves every toast on a light card in dark
	mode. 'system' is passed straight through — sonner resolves it against prefers-color-scheme the
	same way the theme store does. `restProps` spreads last so a caller can still pin a theme.
-->
<Sonner theme={themeStore.current} class="toaster group" {...restProps} />
