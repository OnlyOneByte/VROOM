import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FREEZE_MOTION = '*,*::before,*::after{transition:none!important;animation:none!important}';

export async function scanA11y(page: Page, testInfo: TestInfo, label: string) {
	await page.waitForLoadState('networkidle');
	await page.addStyleTag({ content: FREEZE_MOTION });

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

	await testInfo.attach(`axe-${label}.json`, {
		body: JSON.stringify(results.violations, null, 2),
		contentType: 'application/json'
	});

	return {
		violations: results.violations,
		ids: [...new Set(results.violations.map(violation => violation.id))].sort()
	};
}
