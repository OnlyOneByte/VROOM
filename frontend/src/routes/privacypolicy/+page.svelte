<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
</script>

<svelte:head>
	<title>Privacy Policy — VROOM</title>
	<meta name="description" content="VROOM privacy policy — how we handle your data." />
</svelte:head>

<div class="min-h-screen bg-background">
	<div class="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
		<a
			href={resolve(routes.home)}
			class="inline-flex items-center gap-2 text-sm text-muted-foreground mb-8 hover:text-foreground transition-colors"
		>
			<span>←</span> Back to home
		</a>

		<h1 class="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
		<p class="text-muted-foreground mb-10">Last updated: March 2026</p>

		<div class="space-y-8 text-foreground/90 leading-relaxed">
			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Overview</h2>
				<p>
					VROOM ("the Service") is an open-source, self-hostable vehicle expense tracking
					application. This privacy policy describes how data is collected, used, and stored when
					you use the Service.
				</p>
				<p>
					Because VROOM is designed to be self-hosted, the operator of each instance controls where
					data is stored and how it is managed. This policy covers the default behavior of the
					software.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Data We Collect</h2>
				<p>When you sign in with Google, we receive and store:</p>
				<ul class="list-disc pl-6 space-y-1 text-foreground/80">
					<li>Your Google account email address</li>
					<li>Your display name</li>
					<li>Your Google account ID (for authentication)</li>
				</ul>
				<p>When you use the Service, you may provide:</p>
				<ul class="list-disc pl-6 space-y-1 text-foreground/80">
					<li>Vehicle information (make, model, year, VIN, license plate)</li>
					<li>Expense records (fuel, maintenance, insurance, financing)</li>
					<li>Odometer readings</li>
					<li>Photos of vehicles, receipts, or documents</li>
				</ul>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">How Data Is Stored</h2>
				<p>
					All data is stored in a SQLite database on the server where the instance is hosted. No
					data is sent to third-party analytics services, advertising networks, or data brokers.
				</p>
				<p>
					If you enable Google Drive sync, your data is also stored in your personal Google Drive
					account as CSV files and/or Google Sheets. This data remains under your Google account's
					control and access policies.
				</p>
				<p>
					Photos are stored in your Google Drive. The Service does not store photo files on the
					server.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Google API Usage</h2>
				<p>The Service uses the following Google API scopes:</p>
				<ul class="list-disc pl-6 space-y-1 text-foreground/80">
					<li>Drive file access — to create and manage backup files and photos in your Drive</li>
					<li>Drive app data — to store configuration in your Drive</li>
					<li>Drive install — to connect the app to your Drive</li>
					<li>Sheets access — to mirror your data to a Google Sheets spreadsheet (optional)</li>
				</ul>
				<p>
					The Service only accesses files it creates. It does not read, modify, or delete any other
					files in your Google Drive.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Cookies & Sessions</h2>
				<p>
					The Service uses a session cookie to keep you signed in. This cookie contains only a
					session identifier and is required for the Service to function. No tracking cookies,
					analytics cookies, or third-party cookies are used.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Data Retention & Deletion</h2>
				<p>
					Your data is retained as long as your account exists. You can export all your data at any
					time via the backup feature (CSV format). To delete your account and all associated data,
					contact the instance operator.
				</p>
				<p>
					Data synced to your Google Drive remains in your Drive even if your account on this
					instance is deleted. You can manage or delete that data directly from Google Drive.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Third-Party Services</h2>
				<p>The Service interacts with the following third-party services:</p>
				<ul class="list-disc pl-6 space-y-1 text-foreground/80">
					<li>Google OAuth — for authentication</li>
					<li>Google Drive API — for backup and photo storage (optional)</li>
					<li>Google Sheets API — for data mirroring (optional)</li>
				</ul>
				<p>
					No other third-party services are used. There is no analytics, advertising, or tracking
					integration of any kind.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Open Source</h2>
				<p>
					VROOM is open-source software. You can review the complete source code to verify exactly
					what data is collected and how it is handled. The source code is available on
					<a
						href="https://github.com/OnlyOneByte/vroom"
						class="text-primary underline underline-offset-4 hover:text-primary/80"
						target="_blank"
						rel="noopener noreferrer">GitHub</a
					>.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Changes to This Policy</h2>
				<p>
					This policy may be updated from time to time. Changes will be reflected on this page with
					an updated date. Continued use of the Service after changes constitutes acceptance of the
					updated policy.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Contact</h2>
				<p>
					If you have questions about this privacy policy or how your data is handled, please open
					an issue on the
					<a
						href="https://github.com/OnlyOneByte/vroom"
						class="text-primary underline underline-offset-4 hover:text-primary/80"
						target="_blank"
						rel="noopener noreferrer">GitHub repository</a
					>
					or contact the instance operator.
				</p>
			</section>
		</div>
	</div>
</div>
