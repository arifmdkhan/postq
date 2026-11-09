import { Card } from "@/components/ui/card";
import Link from "next/link";
import { ComposeEntry } from "@/features/composer/entry";
import { Suspense } from "react";
import PostsLoading from "./loading";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { remove } from "@/features/drafts/actions";
import { DraftEditor } from "@/features/drafts/editor";
import { isPlanningDate } from "@/features/drafts/planning";
import { getDraft, listDrafts } from "@/features/drafts/repository";
import { requireUser } from "@/server/auth";

export default function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<PostsLoading />}>
      <DraftWorkspace searchParams={searchParams} />
    </Suspense>
  );
}

async function DraftWorkspace({ searchParams }: Pick<PageProps<"/dashboard">, "searchParams">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const cursor = typeof params.after === "string" ? params.after.slice(0, 36) : undefined;
  const editId = typeof params.edit === "string" ? params.edit.slice(0, 36) : undefined;
  const copyId = typeof params.copy === "string" ? params.copy.slice(0, 36) : undefined;
  const plannedOn = isPlanningDate(params.day) ? params.day : undefined;
  const requestedId = editId ?? copyId;
  const tag = typeof params.tag === "string" ? params.tag.trim().slice(0, 48) : "";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const filters = new URLSearchParams();
  if (tag) filters.set("tag", tag);
  if (query) filters.set("q", query);
  const tagQuery = filters.size ? "&" + filters.toString() : "";
  const [drafts, selected] = await Promise.all([
    listDrafts(user.id, cursor, tag || undefined, query || undefined),
    requestedId ? getDraft(user.id, requestedId) : null,
  ]);
  const page = drafts.slice(0, 20);
  return (
    <section className="flex flex-col gap-6 p-4 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight">Posts</h1>
          <p className="mt-1 text-muted-foreground">A place for posts in progress.</p>
        </div>
        <ComposeEntry date={plannedOn} draftId={editId && selected ? editId : undefined} openInitially={params.compose === "1"} />
      </div>
      <form action="/dashboard" role="search" className="flex gap-2 lg:hidden">
        <Input name="q" type="search" aria-label="Search drafts" defaultValue={query} maxLength={120}
          placeholder="Search drafts…" className="min-w-0 flex-1" />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {selected && (
        <Card className="gap-0 py-0 block rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-lg font-bold">{editId && selected ? "Edit draft" : copyId ? "Duplicate draft" : "New draft"}</h2>
          <DraftEditor key={editId ?? copyId ?? plannedOn ?? "new"} creating={!editId || !selected}
            id={editId && selected ? selected.id : crypto.randomUUID()}
            title={selected?.title} body={selected?.body} tag={selected?.tag ?? undefined}
            updatedAt={selected.updated_at} copyFrom={copyId}
            plannedOn={plannedOn ?? selected?.planned_on ?? undefined} />
          {editId && selected && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/dashboard?copy=${selected.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Duplicate draft</Link>
              <form action={remove.bind(null, selected.id)}>
                <Button type="submit" variant="outline" size="sm">Delete draft</Button>
              </form>
            </div>
          )}
        </Card>
      )}
      {params.saved === "1" && <Alert role="status"><AlertDescription>Draft saved.</AlertDescription></Alert>}
      {query && <p className="text-sm">Search results for <strong>{query}</strong> <Link href="/dashboard" className="ml-2 underline">Clear search</Link></p>}
      {tag && <p className="text-sm">Tag <strong>{tag}</strong> <Link href="/dashboard" className="ml-2 underline">Clear filter</Link></p>}
      {page.length === 0 && (
        <Empty className="border border-dashed"><EmptyHeader><EmptyDescription>
          {cursor ? "No more drafts on this page." : query || tag ? "No drafts match your filters." : "Your saved drafts will appear here."}
        </EmptyDescription></EmptyHeader></Empty>
      )}
      <div className="grid gap-3">
        {page.map((draft) => (
          <Card role="article" key={draft.id} className="gap-0 py-0 block rounded-xl border bg-card p-4">
            <Link href={`/dashboard?edit=${draft.id}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}${tagQuery}`} className="font-semibold break-words hover:underline">{draft.title}</Link>
            {draft.tag && <Badge variant="secondary" className="ml-3" render={<Link href={`/dashboard?tag=${encodeURIComponent(draft.tag)}`} />}>{draft.tag}</Badge>}
          </Card>
        ))}
      </div>
      <nav aria-label="Draft pages" className="flex gap-3">
        {cursor && <Link href={filters.size ? `/dashboard?${filters}` : "/dashboard"} className={buttonVariants({ variant: "outline" })}>First page</Link>}
        {drafts.length > 20 && <Link href={`/dashboard?after=${page.at(-1)?.id}${tagQuery}`} className={buttonVariants({ variant: "outline" })}>Older drafts</Link>}
      </nav>
    </section>
  );
}
