<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';

	interface Props {
		checked: boolean;
		onToggle: (_checked: boolean) => void;
	}

	let { checked, onToggle }: Props = $props();
</script>

<div class="flex items-center gap-2">
	<Checkbox
		id="split-expense-toggle"
		{checked}
		onCheckedChange={v => {
			if (typeof v === 'boolean') onToggle(v);
		}}
	/>
	<Label for="split-expense-toggle" class="cursor-pointer text-sm text-foreground">
		Split this cost among multiple vehicles
	</Label>
</div>
