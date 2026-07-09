// Symmetric encryption for the Gmail refresh token.
//
// WHY: a refresh token never expires and grants permanent "send as this user"
// access, so it must be protected like a password. We encrypt it with
// AES-256-GCM before it touches the database, using a key that lives ONLY in
// the TOKEN_ENCRYPTION_KEY environment variable — never in code or the DB.
// If the database ever leaks, the tokens are useless without that env var.
//
// WHY GCM (and not plain AES-CBC): GCM is authenticated encryption — it
// produces a "tag" that lets decryption detect any tampering or corruption.
// Decrypting modified ciphertext fails loudly instead of returning garbage.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is the recommended size for GCM

/** Parse the env key (64 hex chars = 32 bytes) or explain exactly what's wrong. */
function getKey() {
  const hex = env.tokenEncryptionKey;
  if (!hex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        'and add it to backend/.env',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a secret. Returns a single storable string:
 *   "v1:<iv base64>:<auth tag base64>:<ciphertext base64>"
 * A fresh random IV is generated per call — encrypting the same value twice
 * yields different ciphertexts, so nothing about the plaintext leaks.
 * @param {string} plaintext
 */
export function encryptToken(plaintext) {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a string produced by encryptToken. Throws if the payload was
 * tampered with or the key is wrong.
 * @param {string} stored
 * @returns {string} the original plaintext
 */
export function decryptToken(stored) {
  const [version, ivB64, tagB64, dataB64] = String(stored).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Encrypted token has an unexpected format.');
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
