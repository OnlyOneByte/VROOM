import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/**
 * One axe scan, one attachment, one sorted set of rule ids.
 *
 * Shared so every accessibility assertion in the suite measures the same rule set: a spec
 * that quietly scanned a narrower set of tags would report an empty violation list for a
 * page that fails WCAG, which is worse than not scanning it at all.
 */

/** WCAG 2.0/2.1 level A and AA — the bar the project states it meets. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function scanA11y(page: Page, testInfo: TestInfo, label: string) {
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

	// Attached unconditionally: on a pass it is the evidence the scan actually ran, and on a
	// failure it is the only place the offending nodes are recorded.
	await testInfo.attach(`axe-${label}.json`, {
		body: JSON.stringify(results.violations, null, 2),
		contentType: 'application/json'
	});

	return {
		violations: results.violations,
		ids: [...new Set(results.violations.map(violation => violation.id))].sort()
	};
}
