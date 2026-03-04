<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Car,
		ChartBar,
		Cloud,
		Shield,
		ChevronRight,
		CodeXml,
		FileSpreadsheet,
		Lock
	} from 'lucide-svelte';

	let authState = $derived($authStore);
	let visible = $state(false);

	onMount(() => {
		visible = true;
	});

	// Redirect authenticated users straight to dashboard
	$effect(() => {
		if (!authState.isLoading && authState.isAuthenticated) {
			goto('/dashboard');
		}
	});
</script>

<svelte:head>
	<title>VROOM — Vehicle Record & Organization Of Maintenance</title>
	<meta
		name="description"
		content="Open-source vehicle expense tracking with Google Drive sync. No lock-in, no proprietary databases."
	/>
</svelte:head>

<div class="min-h-screen bg-background">
	<!-- Hero Section -->
	<div class="relative overflow-hidden">
		<!-- Subtle background pattern -->
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-1/5"
		></div>

		<div class="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
			<!-- Nav bar -->
			<nav class="flex items-center justify-between py-6">
				<div class="flex items-center gap-3">
					<div class="inline-flex items-center justify-center w-10 h-10 bg-primary rounded-xl">
						<span class="text-xl">🚗</span>
					</div>
					<span class="text-xl font-bold text-foreground">VROOM</span>
				</div>
				<Button variant="outline" onclick={() => goto('/auth')}>
					Sign In
					<ChevronRight class="ml-1 h-4 w-4" />
				</Button>
			</nav>

			<!-- Hero content -->
			<div
				class="py-20 sm:py-32 text-center transition-all duration-700 {visible
					? 'opacity-100 translate-y-0'
					: 'opacity-0 translate-y-4'}"
			>
				<div class="mx-auto max-w-3xl space-y-6">
					<div
						class="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5 text-sm text-muted-foreground"
					>
						<CodeXml class="h-4 w-4" />
						Open source & self-hostable
					</div>

					<h1 class="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground">
						Know your car.
						<span class="block text-primary">Own your data.</span>
					</h1>

					<p class="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground">
						Track every expense, monitor maintenance, and understand what your vehicles really cost
						— all synced to your Google Drive in open CSV format.
					</p>

					<div class="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
						<Button size="lg" class="h-12 px-8 text-base" onclick={() => goto('/auth')}>
							Get Started
							<ChevronRight class="ml-1 h-5 w-5" />
						</Button>
						<Button
							variant="ghost"
							size="lg"
							class="h-12 px-8 text-base text-muted-foreground"
							onclick={() => {
								document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
							}}
						>
							See how it works
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Features Section -->
	<div id="features" class="border-t border-border bg-muted/50 py-20 sm:py-28">
		<div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
			<div class="text-center mb-16">
				<h2 class="text-3xl sm:text-4xl font-bold text-foreground">
					Everything you need. Nothing you don't.
				</h2>
				<p class="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
					VROOM is built for people who want clarity on vehicle costs without giving up control of
					their data.
				</p>
			</div>

			<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-chart-1/10">
						<Car class="h-5 w-5 text-chart-1" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Multi-Vehicle Tracking</h3>
					<p class="text-muted-foreground text-sm">
						Manage all your vehicles in one place. Track fuel, maintenance, insurance, financing,
						and more per vehicle.
					</p>
				</div>

				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-chart-2/10">
						<ChartBar class="h-5 w-5 text-chart-2" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Cost Analytics</h3>
					<p class="text-muted-foreground text-sm">
						See where your money goes with breakdowns by category, vehicle, and time period.
						Understand true cost of ownership.
					</p>
				</div>

				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-chart-3/10">
						<Cloud class="h-5 w-5 text-chart-3" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Google Drive Sync</h3>
					<p class="text-muted-foreground text-sm">
						Your data syncs directly to your Drive as standard CSVs. No proprietary databases, no
						lock-in.
					</p>
				</div>

				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-chart-4/10">
						<Shield class="h-5 w-5 text-chart-4" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Privacy First</h3>
					<p class="text-muted-foreground text-sm">
						No tracking, no ads, no data harvesting. Everything lives with you or in your Google
						Drive, under your control.
					</p>
				</div>

				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-chart-5/10">
						<FileSpreadsheet class="h-5 w-5 text-chart-5" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Open Format</h3>
					<p class="text-muted-foreground text-sm">
						All data exports as CSV. Migrate anywhere, anytime. Your data is always yours to take.
					</p>
				</div>

				<div class="rounded-xl border border-border bg-card p-6 space-y-3">
					<div class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
						<Lock class="h-5 w-5 text-primary" />
					</div>
					<h3 class="text-lg font-semibold text-foreground">Fully Open Source</h3>
					<p class="text-muted-foreground text-sm">
						Fork it, customize it, self-host it. VROOM is yours to make your own with complete
						transparency.
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- CTA Section -->
	<div class="border-t border-border py-20 sm:py-28">
		<div class="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center space-y-6">
			<h2 class="text-3xl sm:text-4xl font-bold text-foreground">Ready to take control?</h2>
			<p class="text-lg text-muted-foreground">
				Sign in with Google to get started. No account creation needed, no credit card required.
			</p>
			<Button size="lg" class="h-12 px-8 text-base" onclick={() => goto('/auth')}>
				Get Started — It's Free
				<ChevronRight class="ml-1 h-5 w-5" />
			</Button>
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-border py-8">
		<div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
			<div class="flex flex-col sm:flex-row items-center justify-between gap-4">
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<span>🚗</span>
					<span>VROOM — Vehicle Record & Organization Of Maintenance</span>
				</div>
				<p class="text-sm text-muted-foreground">Open source. Self-hostable. Yours.</p>
			</div>
		</div>
	</div>
</div>
