/**
 * Session and authentication configuration constants
 */
export const SESSION_CONFIG = {
  COOKIE_MAX_AGE: 30 * 24 * 60 * 60, // 30 days in seconds
  SESSION_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  REFRESH_THRESHOLD: 24 * 60 * 60 * 1000, // 24 hours in ms
  OAUTH_STATE_EXPIRY: 10 * 60 * 1000, // 10 minutes in ms
} as const;
