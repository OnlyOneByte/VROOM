<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte';
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

	let { ...restProps }: SonnerProps = $props();
</script>

<!-- sonner takes its theme from the theme prop, not the .dark class. -->
<Sonner theme={themeStore.current} class="toaster group" {...restProps} />
