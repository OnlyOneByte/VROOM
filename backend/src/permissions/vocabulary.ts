export const PERMISSION_SCOPES = ['server', 'account', 'household', 'vehicle'] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const CORE_ACTIONS = [
  'read',
  'write',
  'delete',
  'delete_own',
  'manage',
  'run',
  'use',
] as const;

export const NAMED_ACTIONS = [
  'transfer',
  'restore',
  'invite',
  'remove',
  'add',
  'record_others',
  'read_others',
] as const;

export const PERMISSION_ACTIONS = [...CORE_ACTIONS, ...NAMED_ACTIONS] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface PermissionInput {
  label: string;
  scope: PermissionScope;
  grantable?: boolean;
  implies?: readonly string[];
  sensitive?: boolean;
}

export interface PermissionDescriptor<Id extends string = string> {
  id: Id;
  label: string;
  scope: PermissionScope;
  grantable: boolean;
  implies: readonly string[];
  sensitive: boolean;
}

export function definePermissions<const T extends Record<string, PermissionInput>>(
  inputs: T
): PermissionDescriptor<keyof T & string>[] {
  return Object.entries(inputs).map(([id, input]) => ({
    id: id as keyof T & string,
    label: input.label,
    scope: input.scope,
    grantable: input.grantable ?? true,
    implies: input.implies ?? [],
    sensitive: input.sensitive ?? false,
  }));
}

const SEGMENT = /^[a-z][a-z_]*$/;

export function parsePermissionId(
  id: string
): { scope: PermissionScope; action: PermissionAction } | null {
  const segments = id.split('.');
  if (segments.length < 2 || segments.length > 3) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  const scope = PERMISSION_SCOPES.find((s) => s === segments[0]);
  const action = PERMISSION_ACTIONS.find((a) => a === segments[segments.length - 1]);
  if (!scope || !action) return null;
  return { scope, action };
}
