<script lang="ts">
	import { onMount } from 'svelte';
	import { TriangleAlert, CircleCheck, TrendingDown, TrendingUp, X } from 'lucide-svelte';
	import { getFuelEfficiency } from '$lib/utils/analytics-api';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
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

	let alerts = $state<any[]>([]);
	let isLoading = $state(true);
	let dismissedAlerts = $state<Set<string>>(new Set());

	onMount(async () => {
		await loadAllEfficiencyAlerts();
	});

	async function loadAllEfficiencyAlerts() {
		try {
			isLoading = true;
			const allAlerts: any[] = [];

			for (const vehicle of vehicles) {
				try {
					const fuelData = await getFuelEfficiency(vehicle.id);
					const vehicleAlerts = analyzeEfficiencyAlerts(fuelData, vehicle);
					allAlerts.push(...vehicleAlerts);
				} catch (error) {
					console.warn(`Failed to load fuel data for vehicle ${vehicle.id}:`, error);
				}
			}

			alerts = allAlerts.sort((a, b) => {
				const severityOrder = { high: 3, medium: 2, low: 1, positive: 0 };
				return (
					(severityOrder[b.severity as keyof typeof severityOrder] || 0) -
					(severityOrder[a.severity as keyof typeof severityOrder] || 0)
				);
			});
		} catch (error) {
			console.error('Error loading efficiency alerts:', error);
		} finally {
			isLoading = false;
		}
	}

	function analyzeEfficiencyAlerts(fuelData: any, vehicle: any) {
		if (!fuelData || !fuelData.trend || fuelData.trend.length < 3) return [];

		const alerts = [];
		const trend = fuelData.trend;
		const averageMPG = fuelData.averageMPG;
		const vehicleName = vehicle.nickname || vehicle.name;

		// Get recent readings (last 3)
		const recentReadings = trend.slice(-3);
		const recentAverage =
			recentReadings.reduce((sum: number, d: any) => sum + d.mpg, 0) / recentReadings.length;

		// Significant efficiency drop
		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = ((averageMPG - recentAverage) / averageMPG) * 100;
			alerts.push({
				id: `${vehicle.id}-efficiency-drop`,
				vehicleId: vehicle.id,
				vehicleName,
				type: 'efficiency_drop',
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium',
				title: `${vehicleName}: Fuel Efficiency Drop`,
				message: `Efficiency dropped ${dropPercentage.toFixed(1)}% below average (${recentAverage.toFixed(1)} vs ${averageMPG.toFixed(1)} MPG)`,
				recommendation:
					dropPercentage > 25
						? 'Schedule maintenance check - possible engine issues'
						: 'Check tire pressure and driving habits',
				timestamp: new Date().toISOString(),
				data: {
					currentMPG: recentAverage,
					averageMPG,
					dropPercentage
				}
			});
		}

		// Consistent improvement
		if (recentReadings.length >= 3) {
			const isImproving = recentReadings.every(
				(reading: any, index: number) => index === 0 || reading.mpg >= recentReadings[index - 1].mpg
			);

			if (isImproving && recentAverage > averageMPG * 1.1) {
				alerts.push({
					id: `${vehicle.id}-efficiency-improvement`,
					vehicleId: vehicle.id,
					vehicleName,
					type: 'efficiency_improvement',
					severity: 'positive',
					title: `${vehicleName}: Efficiency Improvement`,
					message: `Great job! Efficiency improved ${(((recentAverage - averageMPG) / averageMPG) * 100).toFixed(1)}% above average`,
					recommendation: 'Keep up the efficient driving habits',
					timestamp: new Date().toISOString(),
					data: {
						currentMPG: recentAverage,
						averageMPG,
						improvementPercentage: ((recentAverage - averageMPG) / averageMPG) * 100
					}
				});
			}
		}

		// Erratic efficiency (high variance)
		if (trend.length >= 5) {
			const last5 = trend.slice(-5);
			const variance = calculateVariance(last5.map((d: any) => d.mpg));
			const stdDev = Math.sqrt(variance);

			if (stdDev > averageMPG * 0.15) {
				// 15% standard deviation
				alerts.push({
					id: `${vehicle.id}-erratic-efficiency`,
					vehicleId: vehicle.id,
					vehicleName,
					type: 'erratic_efficiency',
					severity: 'medium',
					title: `${vehicleName}: Inconsistent Efficiency`,
					message: `Fuel efficiency varies significantly (±${((stdDev / averageMPG) * 100).toFixed(1)}%)`,
					recommendation: 'Consider consistent driving habits and regular maintenance',
					timestamp: new Date().toISOString(),
					data: {
						averageMPG,
						standardDeviation: stdDev,
						variancePercentage: (stdDev / averageMPG) * 100
					}
				});
			}
		}

		// Low overall efficiency (compared to vehicle class average)
		const vehicleClassAverage = getVehicleClassAverage(vehicle); // This would need vehicle type data
		if (vehicleClassAverage && averageMPG < vehicleClassAverage * 0.8) {
			alerts.push({
				id: `${vehicle.id}-low-efficiency`,
				vehicleId: vehicle.id,
				vehicleName,
				type: 'low_efficiency',
				severity: 'medium',
				title: `${vehicleName}: Below Average Efficiency`,
				message: `Overall efficiency (${averageMPG.toFixed(1)} MPG) is below typical range`,
				recommendation: 'Consider maintenance check or driving habit review',
				timestamp: new Date().toISOString(),
				data: {
					averageMPG,
					classAverage: vehicleClassAverage
				}
			});
		}

		return alerts;
	}

	function calculateVariance(values: number[]): number {
		const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
		const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
		return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
	}

	function getVehicleClassAverage(vehicle: any): number | null {
		// This is a simplified version - in a real app, you'd have a database of vehicle efficiency standards
		// For now, return a generic average based on vehicle age
		const currentYear = new Date().getFullYear();
		const vehicleAge = currentYear - (vehicle.year || currentYear);

		if (vehicleAge < 5) return 28; // Newer vehicles
		if (vehicleAge < 10) return 25; // Mid-age vehicles
		return 22; // Older vehicles
	}

	function dismissAlert(alertId: string) {
		dismissedAlerts.add(alertId);
		dismissedAlerts = new Set(dismissedAlerts); // Trigger reactivity
	}

	function getAlertIcon(alert: any) {
		switch (alert.type) {
			case 'efficiency_improvement':
				return TrendingUp;
			case 'efficiency_drop':
				return TrendingDown;
			case 'erratic_efficiency':
			case 'low_efficiency':
				return TriangleAlert;
			default:
				return TriangleAlert;
		}
	}

	function getAlertVariant(severity: string): 'default' | 'destructive' | 'warning' | 'success' {
		switch (severity) {
			case 'high':
				return 'destructive';
			case 'medium':
				return 'warning';
			case 'positive':
				return 'success';
			default:
				return 'default';
		}
	}

	// Filter out dismissed alerts
	let visibleAlerts = $derived(alerts.filter(alert => !dismissedAlerts.has(alert.id)));
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-semibold text-gray-900">Efficiency Alerts</h2>
		{#if visibleAlerts.length > 0}
			<span
				class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
			>
				{visibleAlerts.length} alert{visibleAlerts.length !== 1 ? 's' : ''}
			</span>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center h-24">
			<div class="text-center">
				<div
					class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"
				></div>
				<p class="text-sm text-gray-600">Analyzing efficiency data...</p>
			</div>
		</div>
	{:else if visibleAlerts.length === 0}
		<Empty>
			<EmptyHeader>
				<EmptyMedia>
					<CircleCheck class="h-12 w-12 text-green-500" />
				</EmptyMedia>
				<EmptyTitle>All Good!</EmptyTitle>
				<EmptyDescription>
					No efficiency alerts at this time. Keep up the good work!
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	{:else}
		<div class="space-y-3">
			{#each visibleAlerts as alert (alert.id)}
				{@const AlertIcon = getAlertIcon(alert)}
				<Alert variant={getAlertVariant(alert.severity)} class="relative pr-8">
					<AlertIcon />
					<button
						onclick={() => dismissAlert(alert.id)}
						class="absolute top-3 right-3 p-1 rounded-full hover:bg-black hover:bg-opacity-10 transition-colors"
						title="Dismiss alert"
						aria-label="Dismiss alert"
					>
						<X class="h-4 w-4" />
					</button>

					<AlertTitle>{alert.title}</AlertTitle>
					<AlertDescription>
						<p class="mb-2">{alert.message}</p>
						<p class="font-medium">💡 {alert.recommendation}</p>

						{#if alert.data}
							<div class="mt-2 text-xs opacity-75">
								{#if alert.type === 'efficiency_drop'}
									Drop: {alert.data.dropPercentage.toFixed(1)}% | Current: {alert.data.currentMPG.toFixed(
										1
									)} MPG | Average: {alert.data.averageMPG.toFixed(1)} MPG
								{:else if alert.type === 'efficiency_improvement'}
									Improvement: +{alert.data.improvementPercentage.toFixed(1)}% | Current: {alert.data.currentMPG.toFixed(
										1
									)} MPG
								{:else if alert.type === 'erratic_efficiency'}
									Variance: ±{alert.data.variancePercentage.toFixed(1)}% | Average: {alert.data.averageMPG.toFixed(
										1
									)} MPG
								{:else if alert.type === 'low_efficiency'}
									Your Average: {alert.data.averageMPG.toFixed(1)} MPG | Typical: {alert.data.classAverage.toFixed(
										1
									)} MPG
								{/if}
							</div>
						{/if}
					</AlertDescription>
				</Alert>
			{/each}
		</div>
	{/if}
</div>
