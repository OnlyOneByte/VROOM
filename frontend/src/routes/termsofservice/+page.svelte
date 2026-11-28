<script lang="ts">
	import LegalPage from '#lib/components/common/LegalPage.svelte';
</script>

<svelte:head>
	<title>Terms of Service - VROOM Car Tracker</title>
	<meta
		name="description"
		content="VROOM terms of service — conditions for using the application."
	/>
</svelte:head>

<LegalPage title="Terms of Service" updated="March 2026">
	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Acceptance of terms</h2>
		<p>
			By accessing or using VROOM ("the Service"), you agree to be bound by these Terms of Service.
			If you do not agree to these terms, do not use the Service.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Description of service</h2>
		<p>
			VROOM is an open-source vehicle expense tracking application that allows you to record and
			analyze vehicle-related costs including fuel, maintenance, insurance, and financing. The
			Service optionally integrates with Google Drive and Google Sheets for data backup and
			synchronization.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Account & authentication</h2>
		<p>
			You sign in using your Google account. You are responsible for maintaining the security of
			your Google account credentials. The Service does not store your Google password.
		</p>
		<p>
			You are responsible for all activity that occurs under your account. Notify the instance
			operator immediately if you suspect unauthorized access.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Your data</h2>
		<p>
			You retain full ownership of all data you enter into the Service. The Service does not claim
			any rights to your data. You can export your data at any time using the built-in backup
			feature, which produces standard CSV files.
		</p>
		<p>
			If you enable Google Drive or Google Sheets integration, your data is copied to your personal
			Google account. That data is governed by Google's terms of service and remains under your
			control.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Acceptable use</h2>
		<p>You agree not to:</p>
		<ul class="list-disc space-y-1 pl-6 marker:text-muted-foreground">
			<li>Use the Service for any unlawful purpose</li>
			<li>Attempt to gain unauthorized access to the Service or its infrastructure</li>
			<li>Interfere with or disrupt the Service or servers connected to it</li>
			<li>Upload malicious content or attempt to exploit vulnerabilities</li>
			<li>Use automated tools to scrape or overload the Service</li>
		</ul>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Service availability</h2>
		<p>
			The Service is provided on an "as available" basis. The operator does not guarantee
			uninterrupted or error-free operation. The Service may be temporarily unavailable for
			maintenance, updates, or reasons beyond the operator's control.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Open source license</h2>
		<p>
			VROOM is open-source software released under the
			<a
				href="https://github.com/OnlyOneByte/vroom/blob/main/LICENSE"
				class="font-medium text-accent-ink underline underline-offset-4 hover:decoration-2"
				target="_blank"
				rel="noopener noreferrer"
			>
				MIT License
			</a>. You are free to fork, modify, and self-host your own instance. The source code is
			available on
			<a
				href="https://github.com/OnlyOneByte/vroom"
				class="font-medium text-accent-ink underline underline-offset-4 hover:decoration-2"
				target="_blank"
				rel="noopener noreferrer"
			>
				GitHub
			</a>.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Disclaimer of warranties</h2>
		<p>
			THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER
			EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
			FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
		</p>
		<p>
			The Service is not a substitute for professional financial, automotive, or insurance advice.
			Data entered into the Service is for personal tracking purposes only.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Limitation of liability</h2>
		<p>
			TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE OPERATOR AND CONTRIBUTORS SHALL NOT BE
			LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING
			BUT NOT LIMITED TO LOSS OF DATA, LOSS OF PROFITS, OR BUSINESS INTERRUPTION, ARISING OUT OF OR
			IN CONNECTION WITH YOUR USE OF THE SERVICE.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Changes to these terms</h2>
		<p>
			These terms may be updated from time to time. Changes will be reflected on this page with an
			updated date. Continued use of the Service after changes constitutes acceptance of the updated
			terms.
		</p>
	</section>

	<section class="space-y-3 border-t pt-5">
		<h2 class="text-base font-semibold">Contact</h2>
		<p>
			If you have questions about these terms, please open an issue on the
			<a
				href="https://github.com/OnlyOneByte/vroom"
				class="font-medium text-accent-ink underline underline-offset-4 hover:decoration-2"
				target="_blank"
				rel="noopener noreferrer"
			>
				GitHub repository
			</a>
			or contact the instance operator.
		</p>
	</section>
</LegalPage>
