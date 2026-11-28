<script lang="ts">
	import { type DateValue, parseDate } from '@internationalized/date';
	import { Calendar } from '#lib/components/ui/calendar/index.js';

	interface Props {
		value?: string | undefined;
		onpick: () => void;
	}

	let { value = $bindable(undefined), onpick }: Props = $props();

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
</script>

<Calendar type="single" bind:value={calendarValue as never} />
