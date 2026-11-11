import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

// Shared so every accessibility assertion measures the same WCAG rule set.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function scanA11y(page: Page, testInfo: TestInfo, label: string) {
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

	// Attached even on pass, as evidence the scan ran; on failure it holds the offending nodes.
	await testInfo.attach(`axe-${label}.json`, {
		body: JSON.stringify(results.violations, null, 2),
		contentType: 'application/json'
	});

	return {
		violations: results.violations,
		ids: [...new Set(results.violations.map(violation => violation.id))].sort()
	};
}
