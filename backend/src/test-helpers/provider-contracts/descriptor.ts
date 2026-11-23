import { describe, expect, test } from 'bun:test';
import {
  type AnyProviderDescriptor,
  toCatalogEntries,
  validateProviderConfig,
  withoutServerState,
} from '../../api/providers/descriptor';

function sampleConfig(descriptor: AnyProviderDescriptor): Record<string, unknown> {
  return Object.fromEntries(
    descriptor.config.fields.map((field) => [
      field.key,
      field.default ?? (field.kind === 'url' ? 'https://files.example.com' : 'value'),
    ])
  );
}

function hasFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value && typeof value === 'object') return Object.values(value).some(hasFunction);
  return false;
}

export function describeDescriptorContract(name: string, descriptor: AnyProviderDescriptor): void {
  describe(`${name} descriptor contract`, () => {
    test('the schema accepts the field defaults', () => {
      expect(() => validateProviderConfig(descriptor, sampleConfig(descriptor))).not.toThrow();
    });

    test('every required field is in the schema', () => {
      const shape = (descriptor.config.schema as unknown as { shape?: Record<string, unknown> })
        .shape;
      for (const field of descriptor.config.fields.filter((f) => f.required)) {
        expect(shape, field.key).toHaveProperty(field.key);
        const missing = { ...sampleConfig(descriptor), [field.key]: undefined };
        expect(() => validateProviderConfig(descriptor, missing), field.key).toThrow();
      }
    });

    test('server-only keys are stripped from client input', () => {
      const serverState = descriptor.serverState ?? [];
      const input = Object.fromEntries(serverState.map((key) => [key, 'from-the-client']));
      expect(withoutServerState(descriptor, { ...input, kept: 1 })).toEqual({ kept: 1 });
    });

    test('the catalog entry is plain JSON with no functions and no secret values', () => {
      const entries = toCatalogEntries({ [name]: descriptor });
      for (const entry of entries) {
        expect(hasFunction(entry)).toBe(false);
        expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
        for (const secret of entry.secrets) {
          expect(Object.keys(secret).sort()).toEqual(['key', 'label', 'required']);
        }
      }
    });
  });
}
