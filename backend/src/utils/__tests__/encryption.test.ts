import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { _clearKeyCache, decrypt, encrypt } from '../encryption';

// Valid 32-byte hex key for tests
const TEST_KEY = 'a'.repeat(64);
const ALT_KEY = 'b'.repeat(64);

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.PROVIDER_ENCRYPTION_KEY;
  process.env.PROVIDER_ENCRYPTION_KEY = TEST_KEY;
  _clearKeyCache();
});

afterEach(() => {
  if (originalKey !== undefined) {
    process.env.PROVIDER_ENCRYPTION_KEY = originalKey;
  } else {
    delete process.env.PROVIDER_ENCRYPTION_KEY;
  }
  _clearKeyCache();
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------
describe('encrypt/decrypt round-trip', () => {
  test('decrypts back to original plaintext', () => {
    const plaintext = 'hello world';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  test('handles empty string', () => {
    const ciphertext = encrypt('');
    expect(decrypt(ciphertext)).toBe('');
  });

  test('handles unicode and special characters', () => {
    const plaintext = '{"refreshToken":"abc123","émojis":"🔑🔒"}';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  test('handles long plaintext', () => {
    const plaintext = randomBytes(4096).toString('base64');
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  test('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same input';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// Wrong key
// ---------------------------------------------------------------------------
describe('wrong key throws', () => {
  test('decrypt with different key throws', () => {
    const ciphertext = encrypt('secret data');
    process.env.PROVIDER_ENCRYPTION_KEY = ALT_KEY;
    _clearKeyCache();
    expect(() => decrypt(ciphertext)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tampered ciphertext
// ---------------------------------------------------------------------------
describe('tampered ciphertext throws', () => {
  test('flipping a byte in ciphertext throws', () => {
    const ciphertext = encrypt('sensitive');
    const buf = Buffer.from(ciphertext, 'base64');
    // Flip a byte in the encrypted payload area (after IV + auth tag = 28 bytes)
    if (buf.length > 28) {
      buf[28] ^= 0xff;
    }
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  test('truncated ciphertext throws', () => {
    const ciphertext = encrypt('data');
    const truncated = ciphertext.slice(0, 10);
    expect(() => decrypt(truncated)).toThrow();
  });

  test('completely invalid base64 still throws', () => {
    expect(() => decrypt('not-valid-ciphertext')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing / invalid key
// ---------------------------------------------------------------------------
describe('missing or invalid encryption key', () => {
  test('throws when PROVIDER_ENCRYPTION_KEY is not set', () => {
    delete process.env.PROVIDER_ENCRYPTION_KEY;
    _clearKeyCache();
    expect(() => encrypt('test')).toThrow(
      'PROVIDER_ENCRYPTION_KEY environment variable is not set'
    );
  });

  test('throws when key is wrong length', () => {
    process.env.PROVIDER_ENCRYPTION_KEY = 'abcd'; // too short
    _clearKeyCache();
    expect(() => encrypt('test')).toThrow('must be a 32-byte hex string');
  });
});
