/**
 * Behavioral guard (C39 deep-review) for `consumeOAuthState` — the single-use, flow-isolated OAuth-state
 * consumer extracted from validateLoginState/validateLinkState (auth/routes.ts). The OAuth `state` is the
 * CSRF token of the login/link/provider round-trip; the existing auth-routes.property.test.ts only
 * SOURCE-STRING-scans the validators (it asserts the code CONTAINS `storedData.flowType` / `'auth-link'`),
 * which would pass even if the logic were inverted and never pins the load-bearing CSRF invariants. This
 * pins the actual BEHAVIOR:
 *   1. SINGLE-USE — a consumed state is gone; a replayed callback can't re-consume it.
 *   2. FLOW ISOLATION — a login state (no flowType) is rejected by a link/provider consume and vice-versa.
 *   3. ANTI-FIXATION — a mismatched/unknown/null state is deleted on the failed lookup, never lingers.
 * Certified CLEAN firsthand C39; this is the merge-surviving net.
 */

import { describe, expect, test } from 'bun:test';
import { consumeOAuthState, type OAuthStateEntry } from '../utils';

function store(...entries: [string, OAuthStateEntry][]): Map<string, OAuthStateEntry> {
  return new Map(entries);
}
const loginEntry: OAuthStateEntry = { createdAt: 1 };
const linkEntry: OAuthStateEntry = { createdAt: 1, flowType: 'auth-link', userId: 'u1' };
const providerEntry: OAuthStateEntry = { createdAt: 1, flowType: 'provider', userId: 'u1' };

describe('consumeOAuthState — single use', () => {
  test('a valid login state is returned once, then gone (replay rejected)', () => {
    const s = store(['st', loginEntry]);
    expect(consumeOAuthState(s, 'st', undefined)).toEqual(loginEntry);
    expect(s.has('st')).toBe(false); // consumed
    expect(consumeOAuthState(s, 'st', undefined)).toBeNull(); // replay
  });

  test('a valid link state is returned once, then gone', () => {
    const s = store(['st', linkEntry]);
    expect(consumeOAuthState(s, 'st', 'auth-link')).toEqual(linkEntry);
    expect(consumeOAuthState(s, 'st', 'auth-link')).toBeNull();
  });
});

describe('consumeOAuthState — flow isolation', () => {
  test('login consume (expectedFlow undefined) REJECTS a link or provider state', () => {
    const s = store(['link', linkEntry], ['prov', providerEntry]);
    expect(consumeOAuthState(s, 'link', undefined)).toBeNull();
    expect(consumeOAuthState(s, 'prov', undefined)).toBeNull();
  });

  test('link consume REJECTS a login or provider state', () => {
    const s = store(['login', loginEntry], ['prov', providerEntry]);
    expect(consumeOAuthState(s, 'login', 'auth-link')).toBeNull();
    expect(consumeOAuthState(s, 'prov', 'auth-link')).toBeNull();
  });

  test('provider consume REJECTS a login or link state', () => {
    const s = store(['login', loginEntry], ['link', linkEntry]);
    expect(consumeOAuthState(s, 'login', 'provider')).toBeNull();
    expect(consumeOAuthState(s, 'link', 'provider')).toBeNull();
  });
});

describe('consumeOAuthState — anti-fixation (failed lookup still deletes)', () => {
  test('a flow-mismatched state is DELETED on the failed consume (cannot linger/replay)', () => {
    const s = store(['link', linkEntry]);
    expect(consumeOAuthState(s, 'link', undefined)).toBeNull(); // login consume rejects the link entry
    expect(s.has('link')).toBe(false); // ...and evicts it
  });

  test('null / unknown state → null, no throw', () => {
    const s = store(['x', loginEntry]);
    expect(consumeOAuthState(s, null, undefined)).toBeNull();
    expect(consumeOAuthState(s, 'unknown', undefined)).toBeNull();
    expect(s.has('x')).toBe(true); // an unrelated entry is untouched
  });
});
