<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		label: string;
		options: readonly Option[];
		selected: readonly string[];
		onToggle: (_value: string) => void;
	}

	let { label, options, selected, onToggle }: Props = $props();
	const labelId = $props.id();
</script>

<div class="space-y-2">
	<p id={labelId} class="text-sm font-medium">{label}</p>
	<div role="group" aria-labelledby={labelId} class="flex flex-wrap gap-2">
		{#each options as option (option.value)}
			{@const pressed = selected.includes(option.value)}
			<button
				type="button"
				aria-pressed={pressed}
				onclick={() => onToggle(option.value)}
				class="inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 {pressed
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground'}"
			>
				{option.label}
			</button>
		{/each}
	</div>
</div>
