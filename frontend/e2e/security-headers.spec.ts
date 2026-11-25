import { test, expect, type Page } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

const PREVIEW = process.env['E2E_TARGET'] === 'preview';
const needsRealBundle = () =>
	test.skip(!PREVIEW, 'needs the production bundle; run with E2E_TARGET=preview');

async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
		document.addEventListener('securitypolicyviolation', event => {
			seen.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});
	return () =>
		page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

test.describe('Security headers', () => {
	test('a page carries the Content-Security-Policy and the other security headers', async ({
		page
	}) => {
		needsRealBundle();
		await mockApi(page, { authenticated: false });
		const response = await page.goto('/');
		const headers = response?.headers() ?? {};

		const csp = headers['content-security-policy'] ?? '';
		expect(csp).toMatch(/(^|;)\s*script-src 'self'/);
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(headers['x-frame-options']).toBe('DENY');
		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	});

	test('the signed-out and signed-in pages load without a CSP violation', async ({
		page,
		context
	}) => {
		needsRealBundle();
		await addSessionCookie(context);
		await mockApi(page);
		const violations = await recordCspViolations(page);

		for (const path of ['/', '/dashboard', '/settings']) {
			await page.goto(path);
			await page.waitForLoadState('networkidle');
			expect(await violations(), path).toEqual([]);
		}
	});
});
