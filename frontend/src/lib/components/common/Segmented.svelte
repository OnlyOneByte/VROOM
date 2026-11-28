<script lang="ts" generics="T extends string">
	import { RadioGroup } from 'bits-ui';
	import { cn } from '#lib/utils.ts';

	interface Props {
		value: T;
		options: readonly { value: T; label: string }[];
		label: string;
		onValueChange?: (_value: T) => void;
		class?: string;
	}

	let { value, options, label, onValueChange, class: className }: Props = $props();
</script>

<RadioGroup.Root
	bind:value={
		() => value,
		v => {
			if (v && v !== value) onValueChange?.(v as T);
		}
	}
	orientation="horizontal"
	aria-label={label}
	class={cn('inline-flex shrink-0 gap-0.5 rounded-full bg-sunk p-0.5', className)}
	data-slot="segmented"
>
	{#each options as option (option.value)}
		<RadioGroup.Item
			value={option.value}
			class="h-10 rounded-full px-3.5 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:bg-surface data-[state=checked]:text-foreground data-[state=checked]:shadow-[0_0_0_1px_var(--border-strong)]"
		>
			{option.label}
		</RadioGroup.Item>
	{/each}
</RadioGroup.Root>
