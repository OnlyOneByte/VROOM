/**
 * Barrel export for all types.
 * Import from '$lib/types' — resolves here.
 * Each domain has its own file for maintainability.
 */

export * from './user.js';
export * from './vehicle.js';
export * from './expense.js';
export * from './insurance.js';
export * from './settings.js';
export * from './forms.js';
export * from './analytics.js';
export * from './common.js';

// Backend API types — canonical definitions live in $lib/services/api-transformer.ts
export type { BackendExpenseRequest, BackendExpenseResponse } from '../services/api-transformer.js';
