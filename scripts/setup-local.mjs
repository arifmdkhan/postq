import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

for (const filename of [".env.local", ".env"]) {
  if (await access(filename).then(() => true, () => false)) {
    console.log("Existing environment file found: " + filename);
    process.exit(0);
  }
}
const example = await readFile(".env.example", "utf8");
let configured = example;
for (const name of ["BETTER_AUTH_SECRET", "POSTQ_BOOTSTRAP_TOKEN", "POSTQ_ENCRYPTION_KEY"]) {
  configured = configured.replace(new RegExp("^" + name + "=$", "m"), name + "=" + randomBytes(32).toString("hex"));
}
await writeFile(".env.local", configured, { flag: "wx" });
console.log("Created .env.local. Use its POSTQ_BOOTSTRAP_TOKEN to create the owner account. Keep POSTQ_ENCRYPTION_KEY backed up.");
