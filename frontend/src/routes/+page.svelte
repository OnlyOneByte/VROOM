<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Bell, Cloud, Fuel } from '@lucide/svelte';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { authApi } from '#lib/services/auth-api.ts';
	import { routes } from '#lib/routes.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Dial from '#lib/components/charts/Dial.svelte';
	import Wordmark from '#lib/components/common/Wordmark.svelte';

	const FEATURES = [
		{
			icon: Fuel,
			title: 'Ten-second logging',
			description: 'Amount first, everything else remembered from last time.'
		},
		{
			icon: Bell,
			title: 'Never miss a service',
			description: 'Reminders by date or miles, with the warning light you already know.'
		},
		{
			icon: Cloud,
			title: 'Your storage, your data',
			description: 'Back up to storage you connect. Export everything as CSV.'
		}
	];

	let demoAvailable = $state(false);
	let startingDemo = $state(false);

	onMount(async () => {
		demoAvailable = await authApi.isDemoAvailable().catch(() => false);
	});

	$effect(() => {
		if (!authStore.isLoading && authStore.isAuthenticated) {
			goto(resolve(routes.dashboard));
		}
	});

	async function openDemo() {
		if (startingDemo) return;
		startingDemo = true;
		try {
			await authApi.startDemo();
			await authStore.initialize();
			if (authStore.isAuthenticated) return;
			appStore.showError("Couldn't open the demo garage. Try again in a moment.");
		} catch (e) {
			appStore.showError(`Couldn't open the demo garage. ${userFacingErrorMessage(e)}`);
		}
		startingDemo = false;
	}
</script>

<svelte:head>
	<title>VROOM — Vehicle Record & Organization Of Maintenance</title>
	<meta
		name="description"
		content="Open-source vehicle expense tracking. Your data stays in open CSV you can take anywhere. No lock-in."
	/>
</svelte:head>

<div class="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-8">
	<nav class="flex items-center justify-between py-6">
		<Wordmark />
		<Button variant="outline" href={resolve(routes.auth)}>Sign in</Button>
	</nav>

	<div
		class="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:py-16"
	>
		<div class="space-y-5">
			<p class="text-[13px] font-medium text-muted-foreground">Open source · self-hosted · yours</p>
			<h1
				class="max-w-[10ch] font-(family-name:--font-fig) text-[64px] leading-[0.9] font-bold uppercase sm:text-[88px]"
			>
				What your car <span class="text-accent-ink">really</span> costs.
			</h1>
			<p class="max-w-[46ch] text-lg text-muted-foreground">
				Log fill-ups, charges, services and loan payments in seconds. VROOM turns them into one
				honest number: cost per mile, all in.
			</p>
			<div class="flex flex-wrap gap-3 pt-2">
				<Button size="lg" href={resolve(routes.auth)}>Get started</Button>
				{#if demoAvailable}
					<Button
						size="lg"
						variant="outline"
						aria-disabled={startingDemo}
						aria-busy={startingDemo}
						onclick={openDemo}
					>
						See a demo garage
					</Button>
				{/if}
			</div>
		</div>

		<figure class="grid justify-items-center gap-4 rounded-(--r-xl) border bg-surface px-6 py-8">
			<div class="w-60 sm:w-72">
				<Dial
					running={46}
					ownership={12}
					max={80}
					valueLabel="58¢"
					caption="ALL-IN ¢ / MI"
					label="Example: true cost per mile, all in: 58¢; running 46¢, ownership 12¢"
				/>
			</div>
			<figcaption class="text-sm text-muted-foreground">
				Daily Driver · 2020 Camry · 22,360 miles
			</figcaption>
		</figure>
	</div>

	<section aria-label="What VROOM does" class="border-t-2 border-foreground py-10">
		<ul class="grid gap-8 sm:grid-cols-3">
			{#each FEATURES as feature (feature.title)}
				{@const Icon = feature.icon}
				<li class="space-y-2">
					<Icon class="size-5 text-accent-ink" aria-hidden="true" />
					<h2 class="font-(family-name:--font-fig) text-2xl leading-none font-bold uppercase">
						{feature.title}
					</h2>
					<p class="text-sm text-muted-foreground">{feature.description}</p>
				</li>
			{/each}
		</ul>
	</section>

	<footer
		class="mt-auto flex flex-col items-center gap-2 border-t py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between"
	>
		<span>Open source. Self-hostable. Yours.</span>
		<div class="flex gap-4">
			<a
				href={resolve(routes.privacyPolicy)}
				class="inline-flex min-h-10 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Privacy Policy
			</a>
			<a
				href={resolve(routes.termsOfService)}
				class="inline-flex min-h-10 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Terms of Service
			</a>
		</div>
	</footer>
</div>
