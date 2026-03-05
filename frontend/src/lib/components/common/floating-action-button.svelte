<script lang="ts">
	import { Plus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		/** Navigation URL (use href for links) */
		href?: string;
		/** Button label text */
		label: string;
		/** Accessible label for screen readers */
		ariaLabel?: string;
		/** Click handler (for non-link FABs) */
		onclick?: () => void;
	}

	let { href, label, ariaLabel, onclick }: Props = $props();
</script>

<Button
	{href}
	{onclick}
	class="fixed bottom-4 left-4 right-4 z-50 h-16 rounded-full sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto flex items-center justify-center gap-2 pl-6 pr-10 bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 border-0 group"
	aria-label={ariaLabel ?? label}
>
	<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
	<span class="font-bold text-lg">{label}</span>
</Button>
