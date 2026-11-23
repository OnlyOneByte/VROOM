import { z } from 'zod';
import { ValidationError } from '../errors';

export function joinStoragePath(...segments: (string | null | undefined)[]): string {
  return segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}

export const storagePathSchema = z
  .string()
  .max(255, 'Folder path must be 255 characters or less')
  .refine((s) => !s.includes('..'), { message: 'Path traversal not allowed' });

export function assertSafeStoragePath(path: string | undefined): void {
  const result = storagePathSchema.safeParse(path ?? '');
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid storage path');
  }
}
