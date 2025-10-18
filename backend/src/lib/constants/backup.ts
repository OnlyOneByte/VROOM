export const BACKUP_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  CURRENT_VERSION: '1.0.0',
  SUPPORTED_MODES: ['preview', 'replace', 'merge'] as const,
  DEFAULT_RETENTION_COUNT: 10,
  MAX_RETENTION_COUNT: 50,
  MIN_RETENTION_COUNT: 1,
} as const;

export type RestoreMode = (typeof BACKUP_CONFIG.SUPPORTED_MODES)[number];
