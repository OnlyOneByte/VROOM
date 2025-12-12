/**
 * Centralized type exports
 *
 * ARCHITECTURAL DECISION: Centralized Type Definitions
 * ====================================================
 * This module provides a single entry point for all shared type definitions.
 *
 * Organization:
 * - analytics.ts: Analytics and reporting types (from services/analytics/types.ts)
 * - sync.ts: Sync and backup types (from services/sync/types.ts)
 * - database.ts: Database entity types (re-exported from db/schema.ts)
 * - api-response.ts: API request/response types
 *
 * Why centralize?
 * - Single location for type discovery
 * - Easier imports (from 'lib/types' instead of deep paths)
 * - Clear separation of concerns
 * - Prevents circular dependencies
 *
 * Usage:
 * ```typescript
 * import type { BackupData, VehicleAnalytics, User } from '../types';
 * ```
 */

// Analytics types
export type {
  AnalyticsQuery,
  DashboardAnalytics,
  TrendData,
  VehicleAnalytics,
} from './analytics';
// API types
export type { ApiError, ApiResponse } from './api-response';
// Database entity types
export type {
  Expense,
  InsurancePolicy,
  NewExpense,
  NewInsurancePolicy,
  NewSession,
  NewUser,
  NewUserSettings,
  NewVehicle,
  NewVehicleFinancing,
  NewVehicleFinancingPayment,
  Session,
  User,
  UserSettings,
  Vehicle,
  VehicleFinancing,
  VehicleFinancingPayment,
  VehicleWithFinancing,
} from './database';

// Sync and backup types
export type { BackupData, BackupMetadata, ParsedBackupData } from './sync';
