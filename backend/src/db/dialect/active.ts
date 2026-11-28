export type DialectName = 'sqlite' | 'pg';

export const POSTGRES_URL = /^postgres(ql)?:\/\//i;

export function dialectFromUrl(url: string | undefined): DialectName {
  return POSTGRES_URL.test(url ?? '') ? 'pg' : 'sqlite';
}

export const ACTIVE_DIALECT: DialectName = dialectFromUrl(process.env.DATABASE_URL);
