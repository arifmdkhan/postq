import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(secret = process.env.POSTQ_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET) {
  if (!secret || secret.length < 32) throw new Error("Application encryption is unavailable");
  return createHash("sha256").update("postq-settings:" + secret).digest();
}
export function encryptSetting(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
export function decryptSetting(value: string, secret?: string) {
  const versioned = value.startsWith("v1:");
  const bytes = Buffer.from(versioned ? value.slice(3) : value, "base64");
  const keys = secret ? [secret] : versioned
    ? [process.env.POSTQ_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET, process.env.POSTQ_PREVIOUS_ENCRYPTION_KEY]
    : [process.env.BETTER_AUTH_SECRET, process.env.POSTQ_PREVIOUS_ENCRYPTION_KEY];
  for (const key of keys) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    } catch { /* Try the explicitly configured previous key during rotation. */ }
  }
  throw new Error("Saved credential cannot be decrypted. Re-enter it in Settings or restore its encryption key.");
}

export function integrationConfiguration(rows: { name: string; value: string }[], env: Record<string, string | undefined>) {
  const config = { ...env };
  const errors: string[] = [];
  for (const { name, value } of rows) {
    const key = name.slice("integration:".length);
    try {
      const secret = value.startsWith("v1:") ? env.POSTQ_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET : env.BETTER_AUTH_SECRET;
      try {
        if (!secret) throw new Error("No encryption key");
        config[key] = decryptSetting(value, secret);
      }
      catch {
        if (!env.POSTQ_PREVIOUS_ENCRYPTION_KEY) throw new Error("No previous key");
        config[key] = decryptSetting(value, env.POSTQ_PREVIOUS_ENCRYPTION_KEY);
      }
    } catch {
      // A damaged saved value must not silently fall back to a different account's environment credential.
      config[key] = undefined;
      errors.push(key);
    }
  }
  config.POSTQ_CONFIG_ERRORS = errors.join(", ");
  return config;
}
