import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function fixture(t) {
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations=new URL("../../migrations/",import.meta.url);
  for(const file of readdirSync(migrations).filter((name)=>name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file,migrations),"utf8"));
  const db={prepare(sql){const build=(values=[])=>({bind(...args){return build(args);},execute(){return{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};},async run(){return this.execute();},
    async first(name){const row=sqlite.prepare(sql).get(...values);return name?row?.[name]??null:row??null;},async all(){return{results:sqlite.prepare(sql).all(...values)};}});return build();},
    async batch(statements){sqlite.exec("BEGIN");try{const results=statements.map(statement=>statement.execute());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const now=new Date().toISOString();
  sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run("owner","Owner","owner@example.com",1,now,now);
  sqlite.prepare("INSERT INTO channels(id,user_id,remote_id,active,platform) VALUES ('channel','owner','fake',1,'threads')").run();
  t.after(()=>sqlite.close());
  return {sqlite,db};
}
