import type { z } from 'zod';
import { ValidationError } from '../../errors';

export type Capability = 'storage' | 'auth' | 'ai.llm' | 'ai.vision' | 'import';

export interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'select' | 'number' | 'path';
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number;
}

export interface SecretSpec {
  key: string;
  label: string;
  required: boolean;
  reenterWhenChanged?: string[];
}

export type Availability = 'available' | 'hidden';

export interface ProviderDescriptor<Cap extends Capability, Input, Instance, Features> {
  capability: Cap;
  label: string;
  shortLabel?: string;
  description: string;
  scope: 'user' | 'server' | 'builtin';
  availability: () => Availability;
  config: { schema: z.ZodType; fields: FieldSpec[] };
  secrets: SecretSpec[];
  connect: 'form' | 'oauth' | 'none';
  features: Features;
  create: (input: Input) => Instance;
  identity?: (config: Record<string, unknown>) => string | null;
  serverState?: string[];
}

export interface CatalogEntry<Cap extends Capability = Capability, Features = unknown> {
  id: string;
  capability: Cap;
  label: string;
  shortLabel: string;
  description: string;
  scope: 'user' | 'server' | 'builtin';
  connect: 'form' | 'oauth' | 'none';
  fields: FieldSpec[];
  secrets: SecretSpec[];
  features: Features;
}

export const alwaysAvailable = (): Availability => 'available';

export function toCatalogEntries<Cap extends Capability, Features>(
  descriptors: Record<string, ProviderDescriptor<Cap, never, unknown, Features>>
): CatalogEntry<Cap, Features>[] {
  return Object.entries(descriptors)
    .filter(([, d]) => d.availability() === 'available')
    .map(([id, d]) => ({
      id,
      capability: d.capability,
      label: d.label,
      shortLabel: d.shortLabel ?? d.label,
      description: d.description,
      scope: d.scope,
      connect: d.connect,
      fields: d.config.fields,
      secrets: d.secrets.map(({ key, label, required }) => ({ key, label, required })),
      features: d.features,
    }));
}

export type AnyProviderDescriptor = ProviderDescriptor<Capability, never, unknown, unknown>;

export function validateProviderConfig(
  descriptor: AnyProviderDescriptor,
  config: Record<string, unknown> | null,
  toleratedKeys: string[] = []
): void {
  const parsed = descriptor.config.schema.safeParse(config ?? {});
  if (parsed.success) return;
  const issue = parsed.error.issues.find(
    (i) => i.code !== 'unrecognized_keys' || i.keys.some((key) => !toleratedKeys.includes(key))
  );
  if (issue) throw new ValidationError(issue.message);
}

export function withoutServerState(
  descriptor: AnyProviderDescriptor,
  config: Record<string, unknown>
): Record<string, unknown> {
  const serverState = descriptor.serverState ?? [];
  return Object.fromEntries(Object.entries(config).filter(([key]) => !serverState.includes(key)));
}

export function validateProviderSecrets(
  descriptor: AnyProviderDescriptor,
  domainLabel: string,
  credentials: Record<string, unknown>
): void {
  for (const secret of descriptor.secrets) {
    if (secret.required && !credentials[secret.key]) {
      const article = /^[aeiou]/i.test(secret.label) ? 'an' : 'a';
      throw new ValidationError(`${domainLabel} provider requires ${article} ${secret.label}`);
    }
  }
}

const REENTRY_FIELD_LABELS: Record<string, string> = { baseUrl: 'Base URL', endpoint: 'Endpoint' };

export function assertSecretsReentered(
  descriptor: AnyProviderDescriptor,
  stored: Record<string, unknown>,
  changes: Record<string, unknown>,
  credentials: Record<string, unknown> | undefined
): void {
  for (const secret of descriptor.secrets) {
    if (credentials?.[secret.key]) continue;
    const changed = (secret.reenterWhenChanged ?? []).find(
      (key) => Object.hasOwn(changes, key) && !Object.is(changes[key], stored[key])
    );
    if (changed === undefined) continue;
    const field =
      descriptor.config.fields.find((f) => f.key === changed)?.label ??
      REENTRY_FIELD_LABELS[changed] ??
      changed;
    throw new ValidationError(`Enter the ${secret.label} again: the ${field} changed`);
  }
}
