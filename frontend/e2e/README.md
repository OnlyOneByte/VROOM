# VROOM E2E Tests

End-to-end tests for VROOM Car Tracker using Playwright.

## Overview

These tests cover critical user journeys and ensure the application works correctly across different browsers and devices.

## Test Coverage

### Authentication (`auth.spec.ts`)

- Google OAuth login flow
- Session management
- Protected route access
- User profile display
- Logout functionality

**Requirements Covered:** 3.1, 3.2, 3.3, 3.4

### Vehicle Management (`vehicle-management.spec.ts`)

- Adding new vehicles
- Viewing vehicle list
- Vehicle form validation
- Loan information display
- Vehicle filtering

**Requirements Covered:** 2.1, 2.2, 2.3, 2.4

### Expense Entry (`expense-entry.spec.ts`)

- Creating expenses with categorization
- Fuel expense with MPG calculation
- Form validation
- Expense listing and filtering
- Mobile-optimized input
- Expense deletion

**Requirements Covered:** 1.1, 1.2, 1.3, 1.4

### PWA Functionality (`pwa.spec.ts`)

- PWA manifest validation
- Service worker registration
- Offline functionality
- Offline expense entry
- Data synchronization
- Mobile responsive behavior
- Touch-friendly UI elements

**Requirements Covered:** 1.1, 1.2, 1.4

## Running Tests

### Run all tests

```bash
npm run test:e2e
```

### Run with UI mode (interactive)

```bash
npm run test:e2e:ui
```

### Run in headed mode (see browser)

```bash
npm run test:e2e:headed
```

### Run specific browser

```bash
npm run test:e2e:chromium
```

### Run mobile tests only

```bash
npm run test:e2e:mobile
```

### Run specific test file

```bash
npx playwright test e2e/auth.spec.ts
```

## Test Projects

The tests run across multiple browser configurations:

- **Desktop Browsers:**
  - Chromium (Chrome/Edge)
  - Firefox
  - WebKit (Safari)

- **Mobile Devices:**
  - Mobile Chrome (Pixel 5)
  - Mobile Safari (iPhone 12)

## Writing New Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
	test('should do something', async ({ page }) => {
		await page.goto('/path');

		// Interact with page
		await page.getByRole('button', { name: /click me/i }).click();

		// Assert expectations
		await expect(page.getByText('Success')).toBeVisible();
	});
});
```

### Best Practices

1. **Use semantic selectors:** Prefer `getByRole`, `getByLabel`, `getByText` over CSS selectors
2. **Mock API responses:** Use `page.route()` to mock backend responses
3. **Test user journeys:** Focus on complete workflows, not individual components
4. **Mobile-first:** Always test mobile responsiveness
5. **Accessibility:** Ensure interactive elements are properly labeled
6. **Wait for elements:** Use `await expect().toBeVisible()` instead of arbitrary timeouts

### Authentication Helper

Most tests need authentication. Use the helper function:

```typescript
async function setupAuthenticatedSession(page, context) {
	await context.addCookies([
		{
			name: 'auth_session',
			value: 'mock_session_token',
			domain: 'localhost',
			path: '/',
			httpOnly: true,
			secure: false,
			sameSite: 'Lax'
		}
	]);

	await page.route('**/api/auth/me', async route => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: 'user123',
				email: 'test@example.com',
				displayName: 'Test User'
			})
		});
	});
}

test.beforeEach(async ({ page, context }) => {
	await setupAuthenticatedSession(page, context);
});
```

## Debugging Tests

### View test report

```bash
npx playwright show-report
```

### Debug specific test

```bash
npx playwright test --debug e2e/auth.spec.ts
```

### Generate trace

```bash
npx playwright test --trace on
```

## CI/CD Integration

Tests are configured to run in CI with:

- Automatic retries (2 retries on failure)
- Single worker for stability
- HTML report generation
- Screenshots on failure
- Trace on first retry

## Troubleshooting

### Tests timing out

- Increase timeout in `playwright.config.ts`
- Check if backend is running
- Verify network requests are being mocked

### Flaky tests

- Add explicit waits: `await expect(element).toBeVisible()`
- Avoid `page.waitForTimeout()` - use event-based waits
- Check for race conditions in async operations

### Mobile tests failing

- Verify viewport size is set correctly
- Check touch target sizes (minimum 44x44px)
- Test on actual mobile devices if possible

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)
