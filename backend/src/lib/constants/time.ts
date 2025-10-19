/**
 * Time-related constants
 */
export const TIME_CONSTANTS = {
  MILLISECONDS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  DAYS_PER_MONTH: 30, // Average for calculations

  // Derived constants
  MS_PER_MINUTE: 60 * 1000,
  MS_PER_HOUR: 60 * 60 * 1000,
  MS_PER_DAY: 24 * 60 * 60 * 1000,

  SECONDS_PER_HOUR: 60 * 60,
  SECONDS_PER_DAY: 24 * 60 * 60,
} as const;
