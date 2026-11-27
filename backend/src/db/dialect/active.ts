export type DialectName = 'sqlite' | 'pg';

export function dialectFromUrl(url: string | undefined): DialectName {
  return /^postgres(ql)?:\/\//i.test(url ?? '') ? 'pg' : 'sqlite';
}

export const ACTIVE_DIALECT: DialectName = dialectFromUrl(process.env.DATABASE_URL);
