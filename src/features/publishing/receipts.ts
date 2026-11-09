export function validPostReceipt(platform: string, value: string) {
  if (platform === "linkedin") return /^urn:li:(share|ugcPost):\d+$/.test(value);
  if (platform === "youtube") return /^[\w-]{11}$/.test(value);
  if (platform === "facebook") return /^\d+(?:_\d+)?$/.test(value);
  return ["threads", "instagram", "pinterest", "tiktok"].includes(platform) && /^\d{1,32}$/.test(value);
}

export function deliveryFailure(error: unknown) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return "provider_http_" + error.status;
  }
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return "provider_timeout_uncertain";
  return "delivery_unconfirmed";
}
