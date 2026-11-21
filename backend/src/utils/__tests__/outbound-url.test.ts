import { afterEach, describe, expect, test } from 'bun:test';
import { ValidationError } from '../../errors';
import {
  assertSafeOutboundTarget,
  assertSafeOutboundUrl,
  classifyAddress,
  outboundResolver,
} from '../outbound-url';

const stubLookup = outboundResolver.lookup;

afterEach(() => {
  outboundResolver.lookup = stubLookup;
});

describe('classifyAddress', () => {
  test.each<[string, ReturnType<typeof classifyAddress>]>([
    ['8.8.8.8', 'public'],
    ['93.184.215.14', 'public'],
    ['2606:4700::1111', 'public'],
    ['10.1.2.3', 'private'],
    ['127.0.0.1', 'private'],
    ['172.20.0.4', 'private'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:7f00:1', 'private'],
    ['169.254.169.254', 'forbidden'],
    ['100.100.100.200', 'forbidden'],
    ['0.0.0.0', 'forbidden'],
    ['::', 'forbidden'],
    ['fe80::1', 'forbidden'],
    ['fd00:ec2::254', 'forbidden'],
    ['::ffff:169.254.169.254', 'forbidden'],
    ['64:ff9b::a9fe:a9fe', 'forbidden'],
    ['224.0.0.1', 'forbidden'],
    ['not-an-ip', 'forbidden'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});

describe('assertSafeOutboundUrl', () => {
  test('accepts a public https URL', () => {
    expect(assertSafeOutboundUrl('https://s3.example.com', 'S3 endpoint', false).hostname).toBe(
      's3.example.com'
    );
  });

  test.each([
    'http://s3.example.com',
    'ftp://s3.example.com',
    'file:///etc/passwd',
    'https://user:pass@s3.example.com',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://10.0.0.5:9000',
    'https://localhost:9000',
    'https://minio.localhost',
    'https://169.254.169.254',
    'https://metadata.google.internal',
    'not a url',
  ])('rejects %s by default', (raw) => {
    expect(() => assertSafeOutboundUrl(raw, 'S3 endpoint', false)).toThrow(ValidationError);
  });

  test('the operator opt-in allows http and private hosts', () => {
    expect(() => assertSafeOutboundUrl('http://localhost:11434/v1', 'LLM', true)).not.toThrow();
    expect(() => assertSafeOutboundUrl('http://192.168.1.20:9000', 'S3', true)).not.toThrow();
  });

  test('the operator opt-in still rejects metadata and link-local hosts', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3', true)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://[fd00:ec2::254]', 'S3', true)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal', 'S3', true)).toThrow(
      ValidationError
    );
  });
});

describe('assertSafeOutboundTarget', () => {
  test('rejects a public-looking name that resolves to a private address', async () => {
    outboundResolver.lookup = async () => ['10.0.0.7'];
    await expect(
      assertSafeOutboundTarget('https://files.example.com', 'S3 endpoint', false)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects when any resolved address is disallowed', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '169.254.169.254'];
    await expect(
      assertSafeOutboundTarget('https://files.example.com', 'S3 endpoint', true)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects a host that does not resolve', async () => {
    outboundResolver.lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      assertSafeOutboundTarget('https://files.example.com', 'S3 endpoint', false)
    ).rejects.toThrow(ValidationError);
  });

  test('accepts a name that resolves only to public addresses', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    const url = await assertSafeOutboundTarget('https://files.example.com', 'S3 endpoint', false);
    expect(url.hostname).toBe('files.example.com');
  });
});
