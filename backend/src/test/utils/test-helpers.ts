// Test utilities for type safety and common patterns

import type { ApiResponse } from '../../types/api-responses.js';
import { getTestDatabase } from '../setup.js';

// Type-safe API response handler
export async function getTypedResponse<T = unknown>(response: Response): Promise<ApiResponse<T>> {
  const data = await response.json();

  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const apiResponse = data as ApiResponse<T>;

  // Handle error responses from Hono HTTPException (they have message but no success field)
  if (typeof apiResponse.success !== 'boolean') {
    // If it's an error response with a message, convert it to ApiResponse format
    if ('message' in apiResponse && typeof apiResponse.message === 'string') {
      return {
        success: false,
        message: apiResponse.message,
        error: apiResponse.message,
      } as ApiResponse<T>;
    }
    throw new Error('Response missing success field');
  }

  return apiResponse;
}

// For responses that return data directly (not wrapped in ApiResponse)
export async function getDirectResponse<T = unknown>(response: Response): Promise<T> {
  const data = await response.json();
  return data as T;
}

// Safe database getter with null check
export function getDb() {
  const db = getTestDatabase();
  if (!db) {
    throw new Error('Test database not initialized');
  }
  return db;
}

// Type assertion helpers for common response types
export function assertSuccessResponse<T>(
  data: ApiResponse<T>
): asserts data is ApiResponse<T> & { success: true; data: T } {
  if (!data.success) {
    throw new Error(`Expected success response but got: ${data.error || 'unknown error'}`);
  }
  if (data.data === undefined) {
    throw new Error('Success response missing data field');
  }
}

export function assertErrorResponse<T>(
  data: ApiResponse<T>
): asserts data is ApiResponse<T> & { success: false } {
  if (data.success) {
    throw new Error('Expected error response but got success');
  }
}

// Mock function helpers for proper typing
export function createMockFunction<T extends (...args: unknown[]) => unknown>() {
  const mockFn = {
    mockResolvedValue: (_value: unknown) => mockFn,
    mockRejectedValue: (_error: unknown) => mockFn,
    mockResolvedValueOnce: (_value: unknown) => mockFn,
    mockRejectedValueOnce: (_error: unknown) => mockFn,
    mockImplementation: (_fn: T) => mockFn,
    mockReturnValue: (_value: unknown) => mockFn,
    mockClear: () => mockFn,
    mockReset: () => mockFn,
    calls: [] as unknown[][],
  };
  return mockFn;
}

// Google API mock response helpers
export interface GoogleDriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

export interface GoogleSheetsResponse {
  data: GoogleDriveFile;
}

export function createMockGoogleDriveResponse(
  overrides: Partial<GoogleDriveFile> = {}
): GoogleSheetsResponse {
  return {
    data: {
      id: 'test-folder-id',
      name: 'VROOM Car Tracker - Test User',
      webViewLink: 'https://drive.google.com/test',
      ...overrides,
    },
  };
}

// Error helpers for mock rejections
export function createMockError(message: string, code?: string): Error {
  const error = new Error(message);
  if (code) {
    (error as Error & { code: string }).code = code;
  }
  return error;
}
