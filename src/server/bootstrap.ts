import { createHash, timingSafeEqual } from "node:crypto";

export function validBootstrapToken(value: string | null, expected = process.env.POSTQ_BOOTSTRAP_TOKEN) {
  if (!expected || expected.length < 32 || !value || value.length > 256) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(value), digest(expected));
}
