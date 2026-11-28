import { describe, expect, test } from 'bun:test';
import { redactRequestLine } from '../log-redaction';

describe('redactRequestLine', () => {
  test.each([
    [
      '<-- GET /api/v1/auth/callback/github?code=0123456789abcdef0123&state=abc',
      '<-- GET /api/v1/auth/callback/github?code=[redacted]&state=[redacted]',
    ],
    [
      '--> GET /api/v1/auth/callback/oidc?state=s&session_state=a.b.c&code=1.2.3 302 4ms',
      '--> GET /api/v1/auth/callback/oidc?state=[redacted]&session_state=[redacted]&code=[redacted] 302 4ms',
    ],
    [
      '<-- GET /api/v1/auth/callback/oidc?error=access_denied&error_description=User%20said%20no',
      '<-- GET /api/v1/auth/callback/oidc?error=access_denied&error_description=[redacted]',
    ],
  ])('sign-in query values are hidden: %s', (line, expected) => {
    expect(redactRequestLine(line)).toBe(expected);
  });

  test('other query values and plain paths are kept', () => {
    const line = '<-- GET /api/v1/expenses?vehicleId=v1&limit=20&period=month';
    expect(redactRequestLine(line)).toBe(line);
  });

  test('calendar feed tokens are still hidden', () => {
    const token = 'a'.repeat(43);
    expect(redactRequestLine(`<-- GET /api/v1/calendar/feed/${token}.ics`)).toBe(
      '<-- GET /api/v1/calendar/feed/[redacted].ics'
    );
  });
});
