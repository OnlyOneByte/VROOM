/**
 * Behavior of consumeOAuthState: single use, flow isolation between login, link and provider
 * states, and eviction of any state on a failed lookup.
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
    expect(s.has('st')).toBe(false);
    expect(consumeOAuthState(s, 'st', undefined)).toBeNull();
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

describe('consumeOAuthState — failed lookup still deletes the state', () => {
  test('a flow-mismatched state is deleted on the failed consume', () => {
    const s = store(['link', linkEntry]);
    expect(consumeOAuthState(s, 'link', undefined)).toBeNull();
    expect(s.has('link')).toBe(false);
  });

  test('null / unknown state → null, no throw', () => {
    const s = store(['x', loginEntry]);
    expect(consumeOAuthState(s, null, undefined)).toBeNull();
    expect(consumeOAuthState(s, 'unknown', undefined)).toBeNull();
    expect(s.has('x')).toBe(true);
  });
});
