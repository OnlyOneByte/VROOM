import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';
import { adminEmailWarnings } from '../outbound-url';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('ADMIN_EMAILS startup warnings', () => {
  test('nothing to say when ADMIN_EMAILS is unset or names an existing account', async () => {
    expect(await adminEmailWarnings([])).toEqual([]);
    expect(await adminEmailWarnings([ctx.user.email.toLowerCase()])).toEqual([]);
  });

  test('an entry that is not an email address is named', async () => {
    const warnings = await adminEmailWarnings([ctx.user.email.toLowerCase(), 'admin.example.com']);
    expect(warnings).toEqual([
      'ADMIN_EMAILS entry "admin.example.com" is not an email address, so it matches nobody',
    ]);
  });

  test('a list where no address has an account yet says only role admins reach private targets', async () => {
    const warnings = await adminEmailWarnings(['nobody-yet@example.com']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('No active account uses an ADMIN_EMAILS address yet');
  });

  test('a listed account that is disabled does not count, and the match ignores case', async () => {
    ctx.sqlite.run('UPDATE users SET email = ? WHERE id = ?', ['Admin@Example.com', ctx.user.id]);
    expect(await adminEmailWarnings(['admin@example.com'])).toEqual([]);
    ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [ctx.user.id]);
    expect(await adminEmailWarnings(['admin@example.com'])).toHaveLength(1);
  });
});
