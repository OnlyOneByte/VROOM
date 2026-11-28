<script lang="ts">
	import { onMount } from 'svelte';
	import { type DateValue, parseDate } from '@internationalized/date';
	import { Calendar } from '#lib/components/ui/calendar/index.js';

	interface Props {
		value?: string | undefined;
		onpick: () => void;
		onready: () => void;
	}

	let { value = $bindable(undefined), onpick, onready }: Props = $props();

	function toDateValue(text: string | undefined): DateValue | undefined {
		if (!text) return undefined;
		try {
			return parseDate(text);
		} catch {
			return undefined;
		}
	}

	let calendarValue = $derived(toDateValue(value));

	$effect(() => {
		if (calendarValue) {
			const newValue = calendarValue.toString();
			if (newValue !== value) {
				value = newValue;
				onpick();
			}
		} else if (value) {
			value = undefined;
		}
	});

	onMount(onready);
</script>

<Calendar type="single" bind:value={calendarValue as never} />
