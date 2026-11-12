import { describe, expect, test } from 'bun:test';

interface ExistingProvider {
  id: string;
  config: Record<string, unknown> | null;
}

function findDuplicate(
  existingProviders: ExistingProvider[],
  newAccountEmail: string | undefined
): ExistingProvider | undefined {
  if (!newAccountEmail) return undefined;

  return existingProviders.find((p) => {
    const cfg = p.config as Record<string, unknown> | null;
    return cfg?.accountEmail === newAccountEmail;
  });
}

describe('Provider duplicate prevention', () => {
  test('different accountEmail allowed — no conflict', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'bob@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('same accountEmail returns conflict', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeDefined();
    expect(duplicate?.id).toBe('prov-1');
  });

  test('different provider types allowed — empty existing list means no conflict', () => {
    const existing: ExistingProvider[] = [];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('no accountEmail on new provider — no conflict check performed', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, undefined);
    expect(duplicate).toBeUndefined();
  });

  test('existing provider with null config — no false positive', () => {
    const existing: ExistingProvider[] = [{ id: 'prov-1', config: null }];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('multiple existing providers — only matches the correct email', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
      { id: 'prov-2', config: { accountEmail: 'bob@gmail.com' } },
      { id: 'prov-3', config: { accountEmail: 'charlie@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'bob@gmail.com');
    expect(duplicate).toBeDefined();
    expect(duplicate?.id).toBe('prov-2');

    const noDuplicate = findDuplicate(existing, 'dave@gmail.com');
    expect(noDuplicate).toBeUndefined();
  });

  test('case-sensitive email comparison — different case is not a duplicate', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'Alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });
});
