<script lang="ts">
	import { Repeat } from '@lucide/svelte';
</script>

<!-- T6: marks an expense auto-materialized by a recurring (type:'expense') reminder -->
<!-- (sourceType==='reminder'). Mirrors SplitExpenseBadge's inline-pill idiom + the C5 -->
<!-- dashboard RecurringCostCard's Repeat icon so the recurring concept reads consistently. -->
<span
	class="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
	title="Auto-created by a recurring reminder"
>
	<Repeat class="size-3" />
	Recurring
</span>
