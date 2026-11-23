import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CONFIG, type EncryptionKeyring, parseEncryptionKeys } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const V2_PREFIX = 'v2:';

export interface SecretContext {
  rowId: string;
  userId: string;
  domain: string;
}

export function secretContextOf(row: {
  id: string;
  userId: string;
  domain: string;
}): SecretContext {
  return { rowId: row.id, userId: row.userId, domain: row.domain };
}

let _cachedKeyring: EncryptionKeyring | null = null;

function getKeyring(): EncryptionKeyring {
  if (_cachedKeyring) return _cachedKeyring;
  _cachedKeyring = parseEncryptionKeys(
    CONFIG.encryption.providerKeys,
    CONFIG.encryption.providerKey
  );
  return _cachedKeyring;
}

export function _clearKeyCache(): void {
  _cachedKeyring = null;
}

function associatedData(context: SecretContext): Buffer {
  return Buffer.from(`${context.rowId}|${context.userId}|${context.domain}`, 'utf8');
}

function seal(plaintext: string, key: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function open(combined: Buffer, key: Buffer, aad: Buffer | null): string {
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be valid');
  }
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function encrypt(plaintext: string, context: SecretContext): string {
  const { currentId, keys } = getKeyring();
  const key = keys.get(currentId) as Buffer;
  const sealed = seal(plaintext, key, associatedData(context)).toString('base64');
  return `${V2_PREFIX}${currentId}:${sealed}`;
}

export function decrypt(ciphertext: string, context: SecretContext): string {
  const { keys } = getKeyring();
  if (ciphertext.startsWith(V2_PREFIX)) {
    const rest = ciphertext.slice(V2_PREFIX.length);
    const sep = rest.indexOf(':');
    const keyId = sep < 0 ? '' : rest.slice(0, sep);
    const key = keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
    return open(Buffer.from(rest.slice(sep + 1), 'base64'), key, associatedData(context));
  }
  const combined = Buffer.from(ciphertext, 'base64');
  let lastError: unknown = null;
  for (const key of keys.values()) {
    try {
      return open(combined, key, null);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not decrypt the secret');
}

export function isCurrentEnvelope(ciphertext: string): boolean {
  return ciphertext.startsWith(`${V2_PREFIX}${getKeyring().currentId}:`);
}
