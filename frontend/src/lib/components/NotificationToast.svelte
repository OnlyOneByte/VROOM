<script lang="ts">
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-svelte';

	interface Notification {
		id: string;
		type: 'success' | 'error' | 'warning' | 'info';
		message: string;
		duration?: number;
	}

	let { notification }: { notification: Notification } = $props();

	const icons = {
		success: CheckCircle,
		error: XCircle,
		warning: AlertTriangle,
		info: Info
	};

	const colors = {
		success: 'bg-green-50 border-green-200 text-green-800',
		error: 'bg-red-50 border-red-200 text-red-800',
		warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
		info: 'bg-blue-50 border-blue-200 text-blue-800'
	};

	const iconColors = {
		success: 'text-green-400',
		error: 'text-red-400',
		warning: 'text-yellow-400',
		info: 'text-blue-400'
	};

	function dismiss() {
		appStore.removeNotification(notification.id);
	}

	onMount(() => {
		// Auto-dismiss after duration if specified
		if (notification.duration && notification.duration > 0) {
			const timer = setTimeout(() => {
				dismiss();
			}, notification.duration);

			return () => clearTimeout(timer);
		}
	});
</script>

<div 
	class="max-w-sm w-full border rounded-lg shadow-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden transform transition-all duration-300 ease-in-out {colors[notification.type]}"
>
	<div class="p-4">
		<div class="flex items-start">
			<div class="flex-shrink-0">
				<svelte:component 
					this={icons[notification.type]} 
					class="h-5 w-5 {iconColors[notification.type]}" 
				/>
			</div>
			<div class="ml-3 w-0 flex-1">
				<p class="text-sm font-medium">
					{notification.message}
				</p>
			</div>
			<div class="ml-4 flex-shrink-0 flex">
				<button
					type="button"
					class="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
					onclick={dismiss}
				>
					<X class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>
</div>