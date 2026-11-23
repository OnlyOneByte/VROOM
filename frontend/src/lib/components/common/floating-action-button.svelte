<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';

	interface Props {
		href?: string;
		label: string;
		onclick?: () => void;
	}

	let { href, label, onclick }: Props = $props();
</script>

<Button
	{href}
	{onclick}
	class="fixed bottom-4 left-4 right-4 z-40 h-14 rounded-full sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto lg:hidden short:static short:z-auto short:mt-6 has-[>svg]:px-6 shadow-lg transition-colors"
>
	<Plus class="size-5" />
	<span class="font-semibold text-base">{label}</span>
</Button>
