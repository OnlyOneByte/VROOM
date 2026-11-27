<script lang="ts">
	import { cn } from '#lib/utils.ts';

	interface Props {
		href?: string;
		label?: string;
		class?: string;
	}

	let { href, label = 'VROOM home', class: className }: Props = $props();

	const base =
		'font-(family-name:--font-fig) text-[22px] font-bold tracking-[0.3em] text-foreground';
</script>

{#snippet letters()}VR<span class="text-accent-ink">O</span>OM{/snippet}

{#if href}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass a resolved path -->
	<a
		{href}
		class={cn(
			base,
			'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
			className
		)}
		aria-label={label}
	>
		{@render letters()}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
	<span class={cn(base, className)}>{@render letters()}</span>
{/if}
