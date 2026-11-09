export const managedPlatforms = ["instagram", "facebook", "youtube", "linkedin", "pinterest"] as const;
export const connectablePlatforms: readonly string[] = ["threads", "tiktok", "x", ...managedPlatforms];
