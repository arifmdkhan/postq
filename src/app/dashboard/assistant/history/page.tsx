import Link from "next/link";
import { Suspense } from "react";
import HistoryLoading from "./loading";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type HistoryProps = { searchParams: Promise<Record<string,string | string[] | undefined>> };
export default function HistoryPage({ searchParams }: HistoryProps) {
  return <Suspense fallback={<HistoryLoading />}><History searchParams={searchParams} /></Suspense>;
}
async function History({ searchParams }: HistoryProps) {
  const user = await requireUser();
  const params = await searchParams;
  const proposals = params.kind === "proposal";
  const query = typeof params.q === "string" ? params.q.slice(0,120) : "";
  const page = typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const db = await database();
  const { results } = proposals
    ? await db.prepare("SELECT id,brief AS title FROM assistant_proposals WHERE user_id=? AND instr(lower(brief),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET ?")
      .bind(user.id,query,(page-1)*25).all<{id:string;title:string}>()
    : await db.prepare("SELECT id,title FROM assistant_chats WHERE user_id=? AND instr(lower(title),lower(?))>0 ORDER BY updated_at DESC,id DESC LIMIT 26 OFFSET ?")
      .bind(user.id,query,(page-1)*25).all<{id:string;title:string}>();
  const url = (number: number, kind = proposals ? "proposal" : "chat") => "/dashboard/assistant/history?" + new URLSearchParams({kind,q:query,page:String(number)});
  return <section className="grid gap-5 p-4 sm:p-7"><h1 className="text-3xl font-bold">Assistant history</h1>
    <nav className="flex gap-4"><Link className="underline" href={url(1,"chat")}>Chats</Link><Link className="underline" href={url(1,"proposal")}>Proposals</Link></nav>
    <form className="flex gap-2"><input type="hidden" name="kind" value={proposals?"proposal":"chat"} /><Input type="search" name="q" aria-label="Search history" defaultValue={query} maxLength={120} /><Button>Search</Button></form>
    {results.slice(0,25).map((item) => <Link key={item.id} className="break-words rounded-lg border p-4 hover:bg-accent" href={"/dashboard/assistant?"+(proposals?"context=":"chat=")+item.id}>{item.title}</Link>)}
    {!results.length && <p>No matching history.</p>}
    <nav aria-label="Assistant history pages" className="flex gap-4">{page>1&&<Link href={url(page-1)} className="underline">Previous</Link>}{results.length>25&&<Link href={url(page+1)} className="underline">Older history</Link>}</nav>
  </section>;
}
