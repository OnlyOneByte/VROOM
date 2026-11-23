import { z } from 'zod';
import { ValidationError } from '../errors';

export function joinStoragePath(...segments: (string | null | undefined)[]): string {
  return segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}

const PATH_TRAVERSAL_MESSAGE = 'Path traversal not allowed';
const hasNoTraversal = (path: string) => !path.includes('..');

export const storagePathSchema = z
  .string()
  .max(255, 'Folder path must be 255 characters or less')
  .refine(hasNoTraversal, { message: PATH_TRAVERSAL_MESSAGE });

export function assertSafeStoragePath(path: string | undefined): void {
  if (!hasNoTraversal(path ?? '')) throw new ValidationError(PATH_TRAVERSAL_MESSAGE);
}
