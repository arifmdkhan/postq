import { database } from "@/server/db";
import { cache } from "react";
import { readTimezonePreferences } from "./timezone-preferences";

export const workspaceTimezonePreferences=cache(async()=>readTimezonePreferences(await database(),process.env.POSTQ_TIMEZONE));

export async function workspaceTimezone() {
  return (await workspaceTimezonePreferences()).timezone;
}
