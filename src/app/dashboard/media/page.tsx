import { FieldSelect } from "@/components/field-select";
import { Suspense } from "react";
import MediaLoading from "./loading";
import Link from "next/link";
import { Folder, Images, Search } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { AssetDetails, AssetPreview } from "@/features/media/details";
import { UploadDialog } from "@/features/media/upload-dialog";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";

const pageSize = 24;
const errors: Record<string, string> = {
  "in-use": "This file is attached to a saved draft or active delivery, or has already been removed.",
  details: "Check the file name, folder, and tags.",
  size: "Choose a file up to 10 MiB.",
  file: "Choose a supported image or video.",
};

export default function MediaPage({ searchParams }: PageProps<"/dashboard/media">) {
  return <Suspense fallback={<MediaLoading />}><Media searchParams={searchParams} /></Suspense>;
}

async function Media({ searchParams }: Pick<PageProps<"/dashboard/media">, "searchParams">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const db = await database();
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const kind = params.kind === "image" || params.kind === "video" ? params.kind : "";
  const folder = typeof params.folder === "string" ? params.folder.trim().slice(0, 80) : "";
  const page = typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const [assets, folders, counts] = await Promise.all([
    db.prepare(`SELECT id,name,bytes,mime,folder,tags,thumbnail FROM media_assets WHERE user_id=?
      AND (? = '' OR instr(lower(name || ' ' || coalesce(folder, '') || ' ' || coalesce(tags, '')), lower(?)) > 0)
      AND (? = '' OR mime LIKE ? || '/%') AND (? = '' OR folder = ?) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(user.id, query, query, kind, kind, folder, folder, pageSize + 1, (page - 1) * pageSize)
      .all<{ id:string;name:string;bytes:number;mime:string;folder:string|null;tags:string|null;thumbnail:number }>(),
    db.prepare("SELECT folder, count(*) AS total FROM media_assets WHERE user_id = ? AND folder IS NOT NULL GROUP BY folder ORDER BY folder LIMIT 100")
      .bind(user.id).all<{ folder: string; total: number }>(),
    db.prepare("SELECT count(*) AS total, sum(mime LIKE 'image/%') AS images, sum(mime LIKE 'video/%') AS videos FROM media_assets WHERE user_id = ?")
      .bind(user.id).first<{ total: number; images: number | null; videos: number | null }>(),
  ]);
  const url = (selectedFolder: string, selectedPage = 1) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (kind) search.set("kind", kind);
    if (selectedFolder) search.set("folder", selectedFolder);
    if (selectedPage > 1) search.set("page", String(selectedPage));
    return `/dashboard/media?${search}`;
  };
  const filtered = Boolean(query || kind || folder);
  return (
    <section className="mx-auto flex w-full max-w-[100rem] flex-col gap-6 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary"><Images className="size-4" aria-hidden /> Studio assets</div>
          <h1 className="text-4xl font-extrabold sm:text-5xl">Media library</h1>
          <p className="mt-2 max-w-lg text-muted-foreground">Find the images and videos you want to use in your next post.</p>
        </div>
        <UploadDialog folder={folder} />
      </header>
      {typeof params.error === "string" && <Alert variant="destructive"><AlertTitle>{Object.hasOwn(errors, params.error) ? errors[params.error] : "Media could not be updated."}</AlertTitle></Alert>}
      {params.updated === "1" && <p role="status">Media details saved.</p>}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Media folders" className="grid gap-1">
            <h2 className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Folders</h2>
            {[{ folder: "", total: counts?.total ?? 0 }, ...folders.results].map(({ folder: name, total }) => (
              <Link href={url(name)} key={name} aria-current={folder === name ? "page" : undefined}
                className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-foreground">
                <Folder className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate">{name || "All media"}</span><span className="tabular-nums">{total}</span>
              </Link>
            ))}
          </nav>
        </aside>
        <div className="grid min-w-0 gap-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="break-words text-xl font-semibold">{folder || "All media"}</h2>
            <Badge variant="secondary">{counts?.images ?? 0} images</Badge><Badge variant="secondary">{counts?.videos ?? 0} videos</Badge>
          </div>
          <Card className="gap-0 py-0"><CardContent className="p-2"><form action="/dashboard/media" className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1 basis-full sm:basis-44">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input key={query} type="search" aria-label="Search media" name="q" defaultValue={query} maxLength={120} placeholder="Search names, folders, or tags" className="min-h-9 pl-9" />
            </div>
            <FieldSelect
              key={`folder:${folder}`}
              aria-label="Folder"
              name="folder"
              defaultValue={folder}
              options={[
                { value: "", label: "All folders" },
                ...((folders.results.map(({ folder }) => ({ value: folder, label: folder }))) ?? [])
              ]}
            />
            <FieldSelect
              key={`kind:${kind}`}
              aria-label="Media type"
              name="kind"
              defaultValue={kind}
              options={[
                { value: "", label: "All types" },
                { value: "image", label: "Images" },
                { value: "video", label: "Videos" }
              ]}
            />
            <Button type="submit" variant="outline">Apply</Button>
            {filtered && <Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/media">Clear</Link>}
          </form></CardContent></Card>
          {assets.results.length === 0 && <Empty className="min-h-64 border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Images /></EmptyMedia>
              <EmptyTitle>{filtered ? "No matching files" : page > 1 ? "No files on this page" : "Your library is empty"}</EmptyTitle>
              <EmptyDescription>{filtered ? "Try another search or clear the filters." : "Upload images and videos to attach them from the composer."}</EmptyDescription>
            </EmptyHeader>
            {filtered ? <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/media">Clear filters</Link> : <UploadDialog folder={folder} variant="outline" />}
          </Empty>}
          <ul className="grid min-w-0 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {assets.results.slice(0, pageSize).map((asset) => (
              <li key={asset.id} className="min-w-0">
                <Card size="sm" className="h-full gap-0 pt-0">
                  <AssetPreview asset={asset} />
                  <CardHeader className="py-3">
                    <CardTitle className="truncate" title={asset.name}>{asset.name}</CardTitle>
                    <CardDescription className="truncate text-xs">{asset.folder ?? "Unfiled"} · {Math.ceil(asset.bytes / 1024).toLocaleString()} KiB</CardDescription>
                    {asset.tags && <p className="truncate text-xs text-muted-foreground" title={asset.tags}>{asset.tags}</p>}
                  </CardHeader>
                  <CardContent className="mt-auto"><AssetDetails asset={asset} /></CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {(page > 1 || assets.results.length > pageSize) && <nav aria-label="Media library pages" className="flex flex-wrap gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline" })} href={url(folder, page - 1)}>Previous</Link>}
            {assets.results.length > pageSize && <Link className={buttonVariants({ variant: "outline" })} href={url(folder, page + 1)}>Next</Link>}
          </nav>}
        </div>
      </div>
    </section>
  );
}
