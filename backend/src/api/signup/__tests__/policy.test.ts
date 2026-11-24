import { describe, expect, test } from 'bun:test';
import { decideSignup, parseDomains, type SignupRequest } from '../policy';

const base: SignupRequest = {
  email: 'new@example.com',
  firstAdmin: false,
  mode: 'open',
  allowedDomains: [],
  serverInvite: false,
  shareInvite: false,
};

describe('who may create an account', () => {
  test.each([
    ['open', {}, { allow: true, role: 'member', via: 'mode' }],
    ['approval', {}, { allow: true, role: 'pending', via: 'mode' }],
    ['invite', {}, { allow: false, reason: 'invite_required' }],
    ['closed', {}, { allow: false, reason: 'closed' }],
    ['invite', { serverInvite: true }, { allow: true, role: 'member', via: 'server_invite' }],
    ['invite', { shareInvite: true }, { allow: true, role: 'member', via: 'share_invite' }],
    ['approval', { shareInvite: true }, { allow: true, role: 'pending', via: 'share_invite' }],
    ['approval', { serverInvite: true }, { allow: true, role: 'member', via: 'server_invite' }],
    ['closed', { serverInvite: true }, { allow: false, reason: 'closed' }],
    ['closed', { shareInvite: true }, { allow: false, reason: 'closed' }],
  ] as const)('%s with %o', (mode, extra, expected) => {
    expect(decideSignup({ ...base, mode, ...extra })).toEqual(expected);
  });

  test('the first account is admin in every mode, whatever its domain', () => {
    for (const mode of ['open', 'approval', 'invite', 'closed'] as const) {
      expect(
        decideSignup({ ...base, mode, firstAdmin: true, allowedDomains: ['other.org'] })
      ).toEqual({ allow: true, role: 'admin', via: 'first_admin' });
    }
  });

  test('allowed domains refuse other domains, except for an admin invite', () => {
    const domains = { allowedDomains: ['example.com'] };
    expect(decideSignup({ ...base, ...domains })).toMatchObject({ allow: true });
    expect(decideSignup({ ...base, ...domains, email: 'a@sub.example.com' })).toEqual({
      allow: false,
      reason: 'domain_not_allowed',
    });
    expect(decideSignup({ ...base, ...domains, email: 'a@evil.com' })).toEqual({
      allow: false,
      reason: 'domain_not_allowed',
    });
    expect(
      decideSignup({ ...base, ...domains, mode: 'invite', email: 'a@evil.com', shareInvite: true })
    ).toEqual({ allow: false, reason: 'domain_not_allowed' });
    expect(
      decideSignup({ ...base, ...domains, mode: 'invite', email: 'a@evil.com', serverInvite: true })
    ).toMatchObject({ allow: true, via: 'server_invite' });
  });

  test('domain lists are trimmed, lower-cased, de-duplicated and accept a leading @', () => {
    expect(parseDomains(' Example.com, @example.com ,,other.org ')).toEqual([
      'example.com',
      'other.org',
    ]);
  });
});
