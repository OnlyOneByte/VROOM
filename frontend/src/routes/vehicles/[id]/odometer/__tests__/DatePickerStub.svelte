<script lang="ts">
	let {
		value = $bindable(undefined),
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby
	}: {
		value?: string | undefined;
		id?: string;
		placeholder?: string;
		class?: string;
		'aria-invalid'?: boolean;
		'aria-describedby'?: string;
	} = $props();
</script>

<input
	{id}
	type="text"
	data-testid="date-picker"
	aria-invalid={ariaInvalid}
	aria-describedby={ariaDescribedby}
	bind:value
/>
