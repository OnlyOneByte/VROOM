<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte';
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

	let { ...restProps }: SonnerProps = $props();
</script>

<!-- sonner styles from its theme prop, not the .dark class, so the store value is passed through. -->
<Sonner theme={themeStore.current} class="toaster group" {...restProps} />
