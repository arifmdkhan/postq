import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { database } from "./db";
import { workspaceOwner } from "./owner";
import { strongPassword } from "./password";
import { validBootstrapToken } from "./bootstrap";
import { runtimeConfiguration } from "@/features/settings/configuration";

export async function auth() {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL } = process.env;
  if (!BETTER_AUTH_URL || !BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
    throw new Error("Set BETTER_AUTH_URL and a random BETTER_AUTH_SECRET of at least 32 characters.");
  }
  const db = await database();
  const owner = await workspaceOwner(db);
  const config = await runtimeConfiguration(db);
  return betterAuth({
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          if (await workspaceOwner(db)) throw new APIError("FORBIDDEN", { message: "This workspace already has an owner. Sign in instead." });
          if (!validBootstrapToken(ctx.headers?.get("x-postq-bootstrap") ?? null)) throw new APIError("FORBIDDEN", { message: "Enter the bootstrap token configured by the server operator." });
          const expected = process.env.POSTQ_OWNER_EMAIL?.trim().toLowerCase();
          if (expected && ctx.body?.email?.trim().toLowerCase() !== expected) throw new APIError("FORBIDDEN", { message: "Use the configured owner email." });
        }
      }),
    },
    databaseHooks: {
      user: { create: { before: async (user) => {
        if (await workspaceOwner(db)) return false;
        const expected = process.env.POSTQ_OWNER_EMAIL?.trim().toLowerCase();
        if (expected && user.email.toLowerCase() !== expected) return false;
      } } },
      session: { create: { before: async (session) => {
        if (await workspaceOwner(db) !== session.userId) return false;
      } } },
    },
    appName: "PostQ",
    baseURL: BETTER_AUTH_URL,
    secret: BETTER_AUTH_SECRET,
    database: db,
    emailAndPassword: {
      enabled: true, disableSignUp: Boolean(owner), minPasswordLength: 12, maxPasswordLength: 128,
      password: { hash: async (password) => {
        if (!strongPassword(password)) throw new APIError("BAD_REQUEST", { message: "Use 12–128 characters with uppercase, lowercase, a number, and a special character." });
        return hashPassword(password);
      } },
    },
    account: { encryptOAuthTokens: true },
    plugins: [nextCookies()],
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: { enabled: true, storage: "database" },
    socialProviders: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET, disableSignUp: true } }
      : {},
  });
}

export const requireUser = cache(async () => {
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("cookie", (await cookies()).toString());
  if (!requestHeaders.get("cookie")) redirect("/login");
  await connection();
  const session = await (await auth()).api.getSession({ headers: requestHeaders });
  if (!session || await workspaceOwner(await database()) !== session.user.id) redirect("/login");
  return session.user;
});
