<script lang="ts">
	import type { Snippet } from 'svelte';
	import { rowAnnouncement, type ChartA11y } from './chart-a11y.ts';

	interface Props {
		a11y: ChartA11y;
		onStep?: (_index: number | null) => void;
		onSelect?: ((_index: number) => void) | undefined;
		class?: string;
		children: Snippet;
	}

	let { a11y, onStep, onSelect, class: className, children }: Props = $props();

	let activeIndex = $state<number | null>(null);
	let announcement = $state('');

	function step(index: number | null) {
		activeIndex = index;
		announcement = index === null ? '' : rowAnnouncement(a11y, index);
		onStep?.(index);
	}

	function nextIndex(
		key: string,
		current: number | null,
		count: number
	): number | null | undefined {
		if (key === 'ArrowRight') {
			return current === null ? 0 : Math.min(current + 1, count - 1);
		}
		if (key === 'ArrowLeft') {
			return current === null ? count - 1 : Math.max(current - 1, 0);
		}
		if (key === 'Home') return 0;
		if (key === 'End') return count - 1;
		if (key === 'Escape' && current !== null) return null;
		return undefined;
	}

	function handleKey(event: KeyboardEvent) {
		const count = a11y.rows.length;
		if (count === 0) return;
		const current = activeIndex !== null && activeIndex < count ? activeIndex : null;
		if (event.key === 'Enter' && current !== null && onSelect) {
			event.preventDefault();
			onSelect(current);
			return;
		}
		const next = nextIndex(event.key, current, count);
		if (next === undefined) return;
		event.preventDefault();
		step(next);
	}

	function handleBlur() {
		if (activeIndex !== null) step(null);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="img"
	aria-label={a11y.summary}
	tabindex="0"
	onkeydown={handleKey}
	onblur={handleBlur}
	class="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px] {className ??
		''}"
>
	{@render children()}
</div>
<p class="sr-only" aria-live="polite">{announcement}</p>
