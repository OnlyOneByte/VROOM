<script lang="ts">
	let {
		value = $bindable(undefined),
		id,
		placeholder
	}: { value?: string | undefined; id?: string; placeholder?: string; class?: string } = $props();
</script>

<input {id} type="text" aria-label={placeholder} bind:value />
