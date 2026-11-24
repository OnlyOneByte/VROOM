import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';
import { adminEmailWarnings } from '../outbound-url';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('ADMIN_EMAILS startup warnings', () => {
  test('nothing to say when ADMIN_EMAILS is unset or names an existing account', () => {
    expect(adminEmailWarnings([])).toEqual([]);
    expect(adminEmailWarnings([ctx.user.email.toLowerCase()])).toEqual([]);
  });

  test('an entry that is not an email address is named', () => {
    const warnings = adminEmailWarnings([ctx.user.email.toLowerCase(), 'admin.example.com']);
    expect(warnings).toEqual([
      'ADMIN_EMAILS entry "admin.example.com" is not an email address, so it matches nobody',
    ]);
  });

  test('a list where no address has an account yet says only role admins reach private targets', () => {
    const warnings = adminEmailWarnings(['nobody-yet@example.com']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('No account uses an ADMIN_EMAILS address yet');
  });
});
