import { CONFIG } from '../config';

export interface PaginationMeta {
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  totalCount: number;
}

export interface PaginatedApiResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Clamp pagination parameters to configured bounds.
 *
 * - limit: min(max(requested ?? defaultPageSize, minPageSize), maxPageSize)
 * - offset: max(requested ?? 0, 0)
 */
export function clampPagination(pagination?: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const { defaultPageSize, minPageSize, maxPageSize } = CONFIG.pagination;
  const limit = Math.min(Math.max(pagination?.limit ?? defaultPageSize, minPageSize), maxPageSize);
  const offset = Math.max(pagination?.offset ?? 0, 0);
  return { limit, offset };
}

/**
 * Build a unified paginated API response envelope.
 *
 * Computes `hasMore` as `offset + data.length < totalCount`.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  totalCount: number,
  limit: number,
  offset: number
): PaginatedApiResponse<T> {
  return {
    success: true,
    data,
    pagination: {
      totalCount,
      limit,
      offset,
      hasMore: offset + data.length < totalCount,
    },
  };
}
