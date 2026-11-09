import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fixture } from "../tests/helpers/database.mjs";

const cleanup=[];
const {sqlite}=fixture({after(fn){cleanup.push(fn);}});
try {
  const count=Number(process.argv[2]||10000);
  assert.ok([10000,100000].includes(count),"Choose 10000 or 100000 fixture records");
  const draft=sqlite.prepare("INSERT INTO drafts(id,user_id,title,body,updated_at) VALUES (?,'owner',?,?,'2026-11-05')");
  const post=sqlite.prepare("INSERT INTO publications(id,user_id,channel_id,title,caption,due_at,status) VALUES (?,'owner','channel',?,'Caption',?,'published')");
  const metric=sqlite.prepare("INSERT INTO publication_metrics(publication_id,captured_at,name,value) VALUES (?,?,'views',?)");
  sqlite.exec("BEGIN");
  for(let i=0;i<count;i++) {
    draft.run(String(i),"Draft "+i,"Body "+i);post.run(String(i),"Post "+i,i);
    for(let n=1;n<=3;n++)metric.run(String(i),n,n*2);
  }
  sqlite.exec("COMMIT");
  const measure=(name,sql,args=[])=>{const start=performance.now();const rows=sqlite.prepare(sql).all(...args);return{name,ms:Math.round((performance.now()-start)*100)/100,rows:rows.length};};
  const report=readFileSync(new URL("../src/app/dashboard/analytics/page.tsx",import.meta.url),"utf8");
  const summary=/db\.prepare\(`(SELECT m\.name,sum[\s\S]*?)`\)/.exec(report)?.[1];
  assert.ok(summary,"Could not find actual analytics summary query");
  const results=[
    measure("draft substring search", "SELECT id FROM drafts WHERE user_id=? AND instr(lower(title),lower(?))>0 ORDER BY updated_at DESC,id DESC LIMIT 21",["owner","Draft 99"]),
    measure("draft search no match (full owner scan)", "SELECT id FROM drafts WHERE user_id=? AND instr(lower(title),lower(?))>0 ORDER BY updated_at DESC,id DESC LIMIT 21",["owner","no fixture matches"]),
    measure("latest metrics summary",summary.replace("${selection}","p.user_id='owner' AND p.status='published'")),
    measure("previous window ranking", "WITH latest AS (SELECT publication_id,name,value,ROW_NUMBER() OVER (PARTITION BY publication_id,name ORDER BY captured_at DESC) AS position FROM publication_metrics) SELECT sum(value) FROM latest WHERE position=1"),
  ];
  assert.equal(sqlite.prepare("SELECT sum(value) AS total FROM publication_metrics_latest").get().total,count*6);
  console.log(JSON.stringify({environment:"Local in-memory SQLite; not Cloudflare D1 qualification",drafts:count,publications:count,rawSnapshots:count*3,results},null,2));
} finally {for(const close of cleanup)close();}
