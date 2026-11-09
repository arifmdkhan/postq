import assert from "node:assert/strict";

const origin = process.env.POSTQ_SMOKE_URL || "http://localhost:3000";
for (const path of ["/", "/login"]) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path + " did not load");
  const html = await response.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map((match) => match[1]))];
  assert.ok(assets.some((asset) => asset.endsWith(".js")), path + " has no scripts");
  for (const asset of assets) {
    const result = await fetch(new URL(asset.replaceAll("&amp;", "&"), origin), { signal: AbortSignal.timeout(20000) });
    assert.equal(result.status, 200, "Missing build asset " + asset);
  }
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  console.log(path + ": HTML, " + assets.length + " assets, and security headers passed");
}
