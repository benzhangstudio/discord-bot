import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Encrypts Discord access tokens before they're saved, so the database and its backups never hold them in
 * plain text (Discord's Developer Terms, section 5(c)). Uses AES-256-GCM with a key made from the private
 * session secret, which lives outside the database and isn't included in backups.
 */
const key = createHash("sha256").update(`number-one:access-token:${config.sessionSecret}`).digest();
const PREFIX = "v1";

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Returns undefined if the value can't be decrypted (e.g. the session secret changed). */
export function decryptToken(stored: string): string | undefined {
  const [prefix, iv, tag, data] = stored.split(":");
  if (prefix !== PREFIX || !iv || !tag || !data) return;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return;
  }
}
