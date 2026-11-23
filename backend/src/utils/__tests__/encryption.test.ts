import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { CONFIG } from '../../config';
import { _clearKeyCache, decrypt, encrypt, isCurrentEnvelope } from '../encryption';

const TEST_KEY = 'a'.repeat(64);
const ALT_KEY = 'b'.repeat(64);
const ROW = { rowId: 'row-1', userId: 'user-1', domain: 'storage' };

const encryption = CONFIG.encryption as {
  providerKey: string | undefined;
  providerKeys: string | undefined;
};
let original: { providerKey: string | undefined; providerKeys: string | undefined };

function useKeys(providerKey: string | undefined, providerKeys?: string): void {
  encryption.providerKey = providerKey;
  encryption.providerKeys = providerKeys;
  _clearKeyCache();
}

function encryptV1(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv, {
    authTagLength: 16,
  });
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

beforeEach(() => {
  original = { providerKey: encryption.providerKey, providerKeys: encryption.providerKeys };
  useKeys(TEST_KEY);
});

afterEach(() => {
  useKeys(original.providerKey, original.providerKeys);
});

describe('encrypt/decrypt round-trip', () => {
  test('decrypts back to original plaintext', () => {
    expect(decrypt(encrypt('hello world', ROW), ROW)).toBe('hello world');
  });

  test('handles empty string', () => {
    expect(decrypt(encrypt('', ROW), ROW)).toBe('');
  });

  test('handles unicode and special characters', () => {
    const plaintext = '{"refreshToken":"abc123","émojis":"🔑🔒"}';
    expect(decrypt(encrypt(plaintext, ROW), ROW)).toBe(plaintext);
  });

  test('handles long plaintext', () => {
    const plaintext = randomBytes(4096).toString('base64');
    expect(decrypt(encrypt(plaintext, ROW), ROW)).toBe(plaintext);
  });

  test('produces different ciphertext for same plaintext (random IV)', () => {
    expect(encrypt('same input', ROW)).not.toBe(encrypt('same input', ROW));
  });

  test('writes the v2 envelope with the current key id', () => {
    useKeys(undefined, `k2=${ALT_KEY},k1=${TEST_KEY}`);
    const ciphertext = encrypt('x', ROW);
    expect(ciphertext.startsWith('v2:k2:')).toBe(true);
    expect(isCurrentEnvelope(ciphertext)).toBe(true);
  });

  test('a single PROVIDER_ENCRYPTION_KEY is the key id "default"', () => {
    expect(encrypt('x', ROW).startsWith('v2:default:')).toBe(true);
  });
});

describe('the envelope is bound to its row', () => {
  test.each([
    ['another row', { ...ROW, rowId: 'row-2' }],
    ['another user', { ...ROW, userId: 'user-2' }],
    ['another domain', { ...ROW, domain: 'llm' }],
  ])('decrypting with %s fails', (_label, other) => {
    const ciphertext = encrypt('secret data', ROW);
    expect(() => decrypt(ciphertext, other)).toThrow();
  });
});

describe('the v1 format is still read', () => {
  test('a v1 value decrypts with the legacy key', () => {
    const legacy = encryptV1('{"apiKey":"sk-old"}', TEST_KEY);
    expect(decrypt(legacy, ROW)).toBe('{"apiKey":"sk-old"}');
    expect(isCurrentEnvelope(legacy)).toBe(false);
  });

  test('a v1 value decrypts with an older key from the list', () => {
    const legacy = encryptV1('old', TEST_KEY);
    useKeys(undefined, `new=${ALT_KEY},old=${TEST_KEY}`);
    expect(decrypt(legacy, ROW)).toBe('old');
  });

  test('a v1 value under a key that is no longer configured fails', () => {
    const legacy = encryptV1('old', TEST_KEY);
    useKeys(ALT_KEY);
    expect(() => decrypt(legacy, ROW)).toThrow();
  });
});

describe('key ids', () => {
  test('an unknown key id fails with its name', () => {
    const ciphertext = encrypt('x', ROW);
    useKeys(undefined, `other=${ALT_KEY}`);
    expect(() => decrypt(ciphertext, ROW)).toThrow('Unknown encryption key id "default"');
  });

  test('an older key in the list still decrypts its v2 values', () => {
    useKeys(undefined, `k1=${TEST_KEY}`);
    const ciphertext = encrypt('x', ROW);
    useKeys(undefined, `k2=${ALT_KEY},k1=${TEST_KEY}`);
    expect(decrypt(ciphertext, ROW)).toBe('x');
    expect(isCurrentEnvelope(ciphertext)).toBe(false);
  });
});

describe('tampered ciphertext throws', () => {
  test('flipping a byte in the sealed part throws', () => {
    const ciphertext = encrypt('sensitive', ROW);
    const [prefix, keyId, body] = ciphertext.split(':');
    const buf = Buffer.from(body as string, 'base64');
    buf[28] = (buf[28] as number) ^ 0xff;
    expect(() => decrypt(`${prefix}:${keyId}:${buf.toString('base64')}`, ROW)).toThrow();
  });

  test('truncated ciphertext throws', () => {
    expect(() => decrypt(encrypt('data', ROW).slice(0, 14), ROW)).toThrow();
  });

  test('completely invalid input still throws', () => {
    expect(() => decrypt('not-valid-ciphertext', ROW)).toThrow();
  });
});

describe('missing or invalid encryption key', () => {
  test('throws when no key is set', () => {
    useKeys(undefined);
    expect(() => encrypt('test', ROW)).toThrow(
      'PROVIDER_ENCRYPTION_KEY environment variable is not set'
    );
  });

  test('throws when key is wrong length', () => {
    useKeys('abcd');
    expect(() => encrypt('test', ROW)).toThrow('must be a 32-byte hex string');
  });

  test.each([
    ['no id', `=${TEST_KEY}`, 'must look like id=hex'],
    ['a bad key', 'k1=abcd', 'key "k1" must be a 32-byte hex string'],
    ['a repeated id', `k1=${TEST_KEY},k1=${ALT_KEY}`, 'lists the key id "k1" twice'],
  ])('throws on a key list with %s', (_label, list, message) => {
    useKeys(undefined, list);
    expect(() => encrypt('test', ROW)).toThrow(message);
  });
});
