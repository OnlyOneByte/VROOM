<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
</script>

<svelte:head>
	<title>Terms of Service — VROOM</title>
	<meta
		name="description"
		content="VROOM terms of service — conditions for using the application."
	/>
</svelte:head>

<div class="min-h-screen bg-background">
	<div class="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
		<a
			href={resolve(routes.home)}
			class="inline-flex items-center gap-2 text-sm text-muted-foreground mb-8 hover:text-foreground transition-colors"
		>
			<span>←</span> Back to home
		</a>

		<h1 class="text-4xl font-bold text-foreground mb-2">Terms of Service</h1>
		<p class="text-muted-foreground mb-10">Last updated: March 2026</p>

		<div class="space-y-8 text-foreground/90 leading-relaxed">
			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Acceptance of Terms</h2>
				<p>
					By accessing or using VROOM ("the Service"), you agree to be bound by these Terms of
					Service. If you do not agree to these terms, do not use the Service.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Description of Service</h2>
				<p>
					VROOM is an open-source vehicle expense tracking application that allows you to record and
					analyze vehicle-related costs including fuel, maintenance, insurance, and financing. The
					Service optionally integrates with Google Drive and Google Sheets for data backup and
					synchronization.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Account & Authentication</h2>
				<p>
					You sign in using your Google account. You are responsible for maintaining the security of
					your Google account credentials. The Service does not store your Google password.
				</p>
				<p>
					You are responsible for all activity that occurs under your account. Notify the instance
					operator immediately if you suspect unauthorized access.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Your Data</h2>
				<p>
					You retain full ownership of all data you enter into the Service. The Service does not
					claim any rights to your data. You can export your data at any time using the built-in
					backup feature, which produces standard CSV files.
				</p>
				<p>
					If you enable Google Drive or Google Sheets integration, your data is copied to your
					personal Google account. That data is governed by Google's terms of service and remains
					under your control.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Acceptable Use</h2>
				<p>You agree not to:</p>
				<ul class="list-disc pl-6 space-y-1 text-foreground/80">
					<li>Use the Service for any unlawful purpose</li>
					<li>Attempt to gain unauthorized access to the Service or its infrastructure</li>
					<li>Interfere with or disrupt the Service or servers connected to it</li>
					<li>Upload malicious content or attempt to exploit vulnerabilities</li>
					<li>Use automated tools to scrape or overload the Service</li>
				</ul>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Service Availability</h2>
				<p>
					The Service is provided on an "as available" basis. The operator does not guarantee
					uninterrupted or error-free operation. The Service may be temporarily unavailable for
					maintenance, updates, or reasons beyond the operator's control.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Open Source License</h2>
				<p>
					VROOM is open-source software released under the
					<a
						href="https://github.com/OnlyOneByte/vroom/blob/main/LICENSE"
						class="text-primary underline underline-offset-4 hover:text-primary/80"
						target="_blank"
						rel="noopener noreferrer">MIT License</a
					>. You are free to fork, modify, and self-host your own instance. The source code is
					available on
					<a
						href="https://github.com/OnlyOneByte/vroom"
						class="text-primary underline underline-offset-4 hover:text-primary/80"
						target="_blank"
						rel="noopener noreferrer">GitHub</a
					>.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Disclaimer of Warranties</h2>
				<p>
					THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER
					EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
					FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
				</p>
				<p>
					The Service is not a substitute for professional financial, automotive, or insurance
					advice. Data entered into the Service is for personal tracking purposes only.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Limitation of Liability</h2>
				<p>
					TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE OPERATOR AND CONTRIBUTORS SHALL NOT BE
					LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
					INCLUDING BUT NOT LIMITED TO LOSS OF DATA, LOSS OF PROFITS, OR BUSINESS INTERRUPTION,
					ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Changes to These Terms</h2>
				<p>
					These terms may be updated from time to time. Changes will be reflected on this page with
					an updated date. Continued use of the Service after changes constitutes acceptance of the
					updated terms.
				</p>
			</section>

			<section class="space-y-3">
				<h2 class="text-xl font-semibold text-foreground">Contact</h2>
				<p>
					If you have questions about these terms, please open an issue on the
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
