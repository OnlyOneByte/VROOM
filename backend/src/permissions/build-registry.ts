import { type PermissionDescriptor, parsePermissionId } from './vocabulary';

export interface PermissionRegistry<Id extends string = string> {
  list: readonly PermissionDescriptor<Id>[];
  get: (id: string) => PermissionDescriptor<Id> | undefined;
  has: (id: string) => id is Id;
}

export class PermissionRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionRegistryError';
  }
}

function validateDescriptor(descriptor: PermissionDescriptor): void {
  const parsed = parsePermissionId(descriptor.id);
  if (!parsed) {
    throw new PermissionRegistryError(
      `Permission "${descriptor.id}" is malformed: use <scope>.<resource>.<action> or <scope>.<action> with a known scope and action`
    );
  }
  if (parsed.scope !== descriptor.scope) {
    throw new PermissionRegistryError(
      `Permission "${descriptor.id}" declares scope "${descriptor.scope}" but its id starts with "${parsed.scope}"`
    );
  }
}

export function buildPermissionRegistry<Id extends string>(
  descriptors: readonly PermissionDescriptor<Id>[]
): PermissionRegistry<Id> {
  const byId = new Map<string, PermissionDescriptor<Id>>();
  for (const descriptor of descriptors) {
    validateDescriptor(descriptor);
    if (byId.has(descriptor.id)) {
      throw new PermissionRegistryError(`Permission "${descriptor.id}" is declared more than once`);
    }
    byId.set(descriptor.id, descriptor);
  }
  for (const descriptor of descriptors) {
    for (const target of descriptor.implies) {
      if (!byId.has(target)) {
        throw new PermissionRegistryError(
          `Permission "${descriptor.id}" implies "${target}", which is not a declared permission`
        );
      }
    }
  }
  return {
    list: [...byId.values()],
    get: (id) => byId.get(id),
    has: (id): id is Id => byId.has(id),
  };
}
