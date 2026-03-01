<script lang="ts">
	import { Car } from 'lucide-svelte';
	import {
		Empty,
		EmptyDescription,
		EmptyHeader,
		EmptyMedia,
		EmptyTitle
	} from '$lib/components/ui/empty';

	interface Props {
		vehicles: Array<{
			id: string;
			name: string;
			nickname?: string;
		}>;
	}

	let { vehicles }: Props = $props();
</script>

<Empty>
	<EmptyHeader>
		<EmptyMedia>
			<Car class="h-8 w-8 text-muted-foreground" />
		</EmptyMedia>
		<EmptyTitle>Vehicle Efficiency Summary Coming Soon</EmptyTitle>
		<EmptyDescription>
			Per-vehicle efficiency comparisons for your {vehicles.length} vehicle{vehicles.length !== 1
				? 's'
				: ''} will be available when analytics are implemented.
		</EmptyDescription>
	</EmptyHeader>
</Empty>
