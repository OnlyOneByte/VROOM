import { describe, expect, test } from 'bun:test';
import { normalizeStorageIdentity, storageProviderIdentity } from '../backup';

function s3Identity(endpoint: string): string {
  const identity = storageProviderIdentity({
    providerType: 's3',
    config: { endpoint, bucket: 'bkt', region: 'us-east-1' },
  });
  if (!identity) throw new Error(`no identity for ${endpoint}`);
  return identity;
}

const SAME_SERVER: [string, string][] = [
  ['minio:9000', 'MINIO:9000'],
  ['MinIO.Lan:9000', 'minio.lan:9000'],
  ['minio:9000/', 'minio:9000'],
  ['NAS:9000/s3', 'nas:9000/s3'],
  ['192.168.1.5:9000', '192.168.1.5:9000/'],
  ['minio_host:9000', 'MINIO_HOST:9000'],
];

describe('S3 endpoints saved as host:port keep matching on restore', () => {
  test.each(SAME_SERVER)('%p and %p give one identity', (a, b) => {
    expect(s3Identity(a)).toBe(s3Identity(b));
  });

  test.each(SAME_SERVER.flat())(
    'normalizing the stored identity of %p again changes nothing',
    (endpoint) => {
      const stored = s3Identity(endpoint);
      expect(normalizeStorageIdentity(stored)).toBe(stored);
    }
  );

  test('the stored form of a host:port endpoint stays the one existing backups carry', () => {
    expect(s3Identity('minio:9000')).toBe('s3:minio://9000/bkt');
    expect(normalizeStorageIdentity('s3:minio://9000/bkt')).toBe('s3:minio://9000/bkt');
    expect(s3Identity('nas:9000/s3')).toBe('s3:nas://9000/s3/bkt');
  });

  test('a raw host:port identity from an older backup matches the provider it came from', () => {
    expect(normalizeStorageIdentity('s3:MINIO:9000/bkt')).toBe(s3Identity('minio:9000'));
    expect(normalizeStorageIdentity('s3:NAS:9000/s3/bkt')).toBe(s3Identity('nas:9000/s3'));
  });

  test('a different port is a different server', () => {
    expect(s3Identity('minio:9000')).not.toBe(s3Identity('minio:9001'));
  });
});
