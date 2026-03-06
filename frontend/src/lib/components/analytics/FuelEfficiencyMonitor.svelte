<script lang="ts">
	import { Fuel } from 'lucide-svelte';
	import {
		Empty,
		EmptyDescription,
		EmptyHeader,
		EmptyMedia,
		EmptyTitle
	} from '$lib/components/ui/empty';

	interface Props {
		vehicleId: string;
		vehicleName: string;
	}

	let { vehicleName }: Props = $props();
</script>

<Empty>
	<EmptyHeader>
		<EmptyMedia>
			<Fuel class="h-8 w-8 text-muted-foreground" />
		</EmptyMedia>
		<EmptyTitle>Fuel Efficiency Monitor Coming Soon</EmptyTitle>
		<EmptyDescription>
			Detailed fuel efficiency tracking for {vehicleName} will be available when analytics are implemented.
			In the meantime, view fuel stats on the vehicle detail page.
		</EmptyDescription>
	</EmptyHeader>
</Empty>
