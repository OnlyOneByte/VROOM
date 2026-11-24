<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import type { CatalogEntry } from '#lib/utils/vehicle-catalog.ts';

	interface Props {
		id: string;
		label: string;
		value: string;
		suggestions: CatalogEntry[];
		listLabel: string;
		placeholder?: string;
		error?: string;
		onPick?: (_entry: CatalogEntry) => void;
		onFocus?: () => void;
	}

	let {
		id,
		label,
		value = $bindable(),
		suggestions,
		listLabel,
		placeholder,
		error,
		onPick,
		onFocus
	}: Props = $props();

	const listId = $derived(`${id}-suggestions`);
	const errorId = $derived(`${id}-error`);

	let open = $state(false);
	let activeIndex = $state(-1);

	let listOpen = $derived(open && suggestions.length > 0);
	let activeEntry = $derived(listOpen ? suggestions[activeIndex] : undefined);

	$effect(() => {
		if (activeEntry) {
			document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
		}
	});

	function close() {
		open = false;
		activeIndex = -1;
	}

	function pick(entry: CatalogEntry) {
		value = entry.name;
		onPick?.(entry);
		close();
	}

	function moveActive(step: number) {
		open = true;
		const count = suggestions.length;
		if (count === 0) return;
		activeIndex =
			step > 0 ? (activeIndex + 1) % count : activeIndex <= 0 ? count - 1 : activeIndex - 1;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			moveActive(e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter' && activeEntry) {
			e.preventDefault();
			pick(activeEntry);
		} else if (e.key === 'Escape' && listOpen) {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}

	function handleFocusOut(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
	}
</script>

<div class="relative space-y-2" onfocusout={handleFocusOut}>
	<Label for={id}>{label}</Label>
	<Input
		{id}
		type="text"
		autocomplete="off"
		{placeholder}
		bind:value
		oninput={() => {
			open = true;
			activeIndex = -1;
		}}
		onfocus={() => {
			open = true;
			onFocus?.();
		}}
		onkeydown={handleKeydown}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={listOpen}
		aria-controls={listOpen ? listId : undefined}
		aria-activedescendant={activeEntry ? `${listId}-${activeIndex}` : undefined}
		aria-invalid={!!error}
		aria-describedby={error ? errorId : undefined}
		required
	/>

	{#if listOpen}
		<div
			id={listId}
			role="listbox"
			aria-label={listLabel}
			tabindex="-1"
			class="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
		>
			{#each suggestions as entry, i (entry.id)}
				<button
					id="{listId}-{i}"
					type="button"
					role="option"
					tabindex="-1"
					aria-selected={i === activeIndex}
					onmousedown={e => e.preventDefault()}
					onclick={() => pick(entry)}
					class="flex w-full min-h-10 items-center px-3 py-2 text-left text-sm hover:bg-accent aria-selected:bg-accent aria-selected:text-accent-foreground sm:min-h-0"
				>
					{entry.name}
				</button>
			{/each}
		</div>
	{/if}

	{#if error}
		<FormFieldError id={errorId}>{error}</FormFieldError>
	{/if}
</div>
