import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({ resolve(specifier,context,next) {
  if (specifier.startsWith("@/")) return next(new URL("../src/"+specifier.slice(2)+".ts",import.meta.url).href,context);
  if (specifier.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/.test(specifier)) {
    const url=new URL(specifier+".ts",context.parentURL);
    if(existsSync(fileURLToPath(url))) return next(url.href,context);
  }
  return next(specifier,context);
} });
