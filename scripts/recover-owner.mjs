import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { strongPassword } from "../src/server/password.ts";

export async function recoverOwner(db,email,password) {
  if (!strongPassword(password)) throw new Error("Password must meet the owner's 12–128 character password rules.");
  const owner=await db.prepare('SELECT u.id,u.email FROM "user" u JOIN workspace_owner o ON o.user_id=u.id WHERE lower(u.email)=?')
    .bind(email.trim().toLowerCase()).first();
  if(!owner) throw new Error("The supplied email is not the existing workspace owner. No account was changed.");
  const now=new Date().toISOString();
  const passwordHash=await hashPassword(password);
  await db.batch([
    db.prepare("DELETE FROM account WHERE userId=? AND providerId='credential'").bind(owner.id),
    db.prepare("INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES (?,?,?,'credential',?,?,?)")
      .bind(crypto.randomUUID(),owner.id,owner.id,passwordHash,now,now),
    db.prepare("DELETE FROM session WHERE userId=?").bind(owner.id),
  ]);
}

export async function prepareRestoredWorkspace(db) {
  await db.prepare("UPDATE publications SET status='review',last_error='restored_requires_owner_review' WHERE status IN ('scheduled','sending')").run();
}

async function main() {
  const args=process.argv.slice(2);
  const value=(flag)=>args[args.indexOf(flag)+1];
  if(!args.includes("--local") || !args.includes("--confirm-recovery") || !args.includes("--email") || !args.includes("--password-file")) {
    throw new Error("Usage: node --experimental-transform-types scripts/recover-owner.mjs --local --email owner@example.com --password-file <private-file> --confirm-recovery");
  }
  for(const file of [".env.local",".env"]) {try {process.loadEnvFile(file);break;} catch(error){if(error.code!=="ENOENT")throw error;} }
  const { getPlatformProxy }=await import("wrangler");
  const proxy=await getPlatformProxy({persist:process.env.POSTQ_LOCAL_STATE?{path:process.env.POSTQ_LOCAL_STATE}:true});
  try {
    const password=(await readFile(value("--password-file"),"utf8")).replace(/\r?\n$/,"");
    await recoverOwner(proxy.env.DB,value("--email"),password);
    console.log("Owner password replaced and all existing sessions revoked. Remove the private password file securely.");
  } finally {await proxy.dispose();}
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch((error)=>{console.error(error.message);process.exitCode=1;});
}
