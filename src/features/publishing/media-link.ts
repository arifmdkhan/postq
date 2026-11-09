async function mediaSignature(secret: string, publicationId: string, expires: number, asset?:string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return { key, message: encoder.encode(asset ? `postq-delivery:${publicationId}:${asset}:${expires}` : `postq-delivery:${publicationId}:${expires}`) };
}

export async function deliveryMediaUrl(origin: string, secret: string, id: string, asset?:string) {
  const expires = Date.now() + 15 * 60_000;
  const { key, message } = await mediaSignature(secret, id, expires,asset);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const url = new URL(`/api/delivery-media/${id}`, origin);
  if (url.protocol !== "https:") throw new Error("Media delivery requires HTTPS");
  url.searchParams.set("expires", String(expires));
  if(asset)url.searchParams.set("asset",asset);
  url.searchParams.set("signature", Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join(""));
  return url.href;
}

export async function verifyDeliveryMedia(secret: string, id: string, expires: number, signature: string, asset?:string) {
  if (!Number.isSafeInteger(expires) || expires <= Date.now() || !/^[a-f\d]{64}$/.test(signature)) return false;
  const { key, message } = await mediaSignature(secret, id, expires,asset);
  const bytes = Uint8Array.from(signature.match(/../g)!, (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, bytes, message);
}
