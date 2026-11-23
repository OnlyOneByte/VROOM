<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { onMount } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import BrandMark from '#lib/components/common/BrandMark.svelte';
	import {
		Car,
		ChartBar,
		Cloud,
		Shield,
		ChevronRight,
		CodeXml,
		Lock,
		Smartphone
	} from '@lucide/svelte';

	const FEATURES = [
		{
			icon: Car,
			title: 'Multi-Vehicle Tracking',
			description: 'Fuel, maintenance, insurance and financing for every vehicle in one place.',
			tint: 'bg-chart-1/10',
			color: 'text-chart-1'
		},
		{
			icon: ChartBar,
			title: 'Cost Analytics',
			description: 'Breakdowns by category, vehicle and period show the true cost of ownership.',
			tint: 'bg-chart-2/10',
			color: 'text-chart-2'
		},
		{
			icon: Cloud,
			title: 'Your Own Storage',
			description: 'Back up and sync to storage you connect, as standard CSV files.',
			tint: 'bg-chart-3/10',
			color: 'text-chart-3'
		},
		{
			icon: Shield,
			title: 'Privacy First',
			description:
				'No tracking, ads or data harvesting. Self-host and your data stays on your server.',
			tint: 'bg-chart-4/10',
			color: 'text-chart-4'
		},
		{
			icon: Smartphone,
			title: 'Install as an App',
			description: 'A Progressive Web App for phone or desktop, with offline support.',
			tint: 'bg-chart-5/10',
			color: 'text-chart-5'
		},
		{
			icon: Lock,
			title: 'Open Source, Open Format',
			description: 'Export everything as CSV, then fork it, customize it or self-host it.',
			tint: 'bg-primary/10',
			color: 'text-primary'
		}
	];

	const authState = authStore;
	let visible = $state(false);

	onMount(() => {
		visible = true;
	});

	$effect(() => {
		if (!authState.isLoading && authState.isAuthenticated) {
			goto(resolve(routes.dashboard));
		}
	});
</script>

<svelte:head>
	<title>VROOM — Vehicle Record & Organization Of Maintenance</title>
	<meta
		name="description"
		content="Open-source vehicle expense tracking. Your data stays in open CSV you can take anywhere. No lock-in."
	/>
</svelte:head>

<div class="min-h-screen bg-background">
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-1/5"
		></div>

		<div class="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
			<nav class="flex items-center justify-between py-6">
				<div class="flex items-center gap-3">
					<div class="inline-flex items-center justify-center w-10 h-10 bg-primary rounded-xl">
						<BrandMark class="h-5 w-5 text-primary-foreground" />
					</div>
					<span class="text-xl font-bold text-foreground">VROOM</span>
				</div>
				<Button variant="outline" class="h-10 sm:h-9" onclick={() => goto(resolve(routes.auth))}>
					Sign In
					<ChevronRight class="ml-1 h-4 w-4" />
				</Button>
			</nav>

			<div
				class="pt-12 pb-16 sm:pt-20 sm:pb-24 text-center transition-all duration-700 {visible
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
						— backed up to storage you choose, in open CSV.
					</p>

					<div class="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
						<Button
							size="lg"
							class="h-12 px-8 text-base"
							onclick={() => goto(resolve(routes.auth))}
						>
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

				<div
					class="mx-auto mt-12 max-w-5xl overflow-hidden rounded-xl border border-border shadow-sm"
				>
					{#each ['light', 'dark'] as scheme (scheme)}
						<picture class={scheme === 'light' ? 'block dark:hidden' : 'hidden dark:block'}>
							<source
								media="(max-width: 639px)"
								srcset="/landing/dashboard-phone-{scheme}.webp"
								width="750"
								height="1360"
							/>
							<img
								src="/landing/dashboard-{scheme}.webp"
								width="1280"
								height="1180"
								alt="The VROOM Dashboard with two vehicles: spending totals, the fleet and monthly cost charts"
								loading="lazy"
								decoding="async"
								class="block h-auto w-full"
							/>
						</picture>
					{/each}
				</div>
			</div>
		</div>
	</div>

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

			<ul class="grid gap-3 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
				{#each FEATURES as feature (feature.title)}
					{@const Icon = feature.icon}
					<li
						class="flex items-start gap-4 rounded-xl border border-border bg-card p-4 sm:block sm:space-y-3 sm:p-6"
					>
						<div
							class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg {feature.tint}"
						>
							<Icon class="h-5 w-5 {feature.color}" />
						</div>
						<div class="min-w-0 space-y-1 sm:space-y-3">
							<h3 class="text-base font-semibold text-foreground sm:text-lg">{feature.title}</h3>
							<p class="text-sm text-muted-foreground">{feature.description}</p>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</div>

	<div class="border-t border-border py-20 sm:py-28">
		<div class="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center space-y-6">
			<h2 class="text-3xl sm:text-4xl font-bold text-foreground">Ready to take control?</h2>
			<p class="text-lg text-muted-foreground">Sign in to get started. No credit card required.</p>
			<Button size="lg" class="h-12 px-8 text-base" onclick={() => goto(resolve(routes.auth))}>
				Get Started — It's Free
				<ChevronRight class="ml-1 h-5 w-5" />
			</Button>
		</div>
	</div>

	<div class="border-t border-border py-8">
		<div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
			<div
				class="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left"
			>
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<BrandMark class="h-4 w-4 text-muted-foreground" />
					<span>VROOM — Vehicle Record & Organization Of Maintenance</span>
				</div>
				<div
					class="flex flex-col items-center gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-4"
				>
					<a
						href={resolve(routes.privacyPolicy)}
						class="inline-flex min-h-10 items-center transition-colors hover:text-foreground sm:min-h-0"
					>
						Privacy Policy
					</a>
					<a
						href={resolve(routes.termsOfService)}
						class="inline-flex min-h-10 items-center transition-colors hover:text-foreground sm:min-h-0"
					>
						Terms of Service
					</a>
					<span>Open source. Self-hostable. Yours.</span>
				</div>
			</div>
		</div>
	</div>
</div>
