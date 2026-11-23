import type { z } from 'zod';

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
      secrets: d.secrets,
      features: d.features,
    }));
}
