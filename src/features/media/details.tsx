import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateAsset, deleteAsset } from "./actions";
import Image from "next/image";
import { Expand, FileVideo, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AssetDetails({ asset }: { asset: { id: string; name: string; folder: string | null; tags: string | null } }) {
  return <div className="flex flex-wrap gap-2">
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit details</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit media details</DialogTitle><DialogDescription>Organize this file in your library.</DialogDescription></DialogHeader>
        <form action={updateAsset.bind(null, asset.id)}>
          <FieldGroup>
            <Field><FieldLabel>Name<Input name="name" defaultValue={asset.name} maxLength={160} required /></FieldLabel></Field>
            <Field><FieldLabel>Folder<Input name="folder" defaultValue={asset.folder ?? ""} maxLength={80} /></FieldLabel></Field>
            <Field><FieldLabel>Tags<Input name="tags" defaultValue={asset.tags ?? ""} maxLength={160} /></FieldLabel></Field>
            <DialogFooter><Button type="submit">Save details</Button></DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Remove this file?</DialogTitle><DialogDescription>{asset.name} will be removed from the library. Files attached to active deliveries are protected.</DialogDescription></DialogHeader>
        <form action={deleteAsset.bind(null, asset.id)}>
          <DialogFooter showCloseButton><Button type="submit" variant="destructive">Remove file</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

export function AssetPreview({ asset }: { asset: { id: string; name: string; mime: string; thumbnail?: number } }) {
  const video = asset.mime.startsWith("video/");
  const source = `/api/media/${asset.id}?preview`;
  return <Dialog>
    <DialogTrigger aria-label={`Preview ${asset.name}`} className="group relative block aspect-[4/3] w-full cursor-pointer overflow-hidden bg-sidebar outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
      {asset.thumbnail
        ? <Image src={`/api/media/${asset.id}?thumbnail`} alt="" fill unoptimized sizes="(min-width: 1280px) 22vw, (min-width: 480px) 50vw, 100vw" className="object-cover motion-safe:transition-transform motion-safe:group-hover:scale-[1.03]" />
        : <div className="absolute inset-0 grid place-items-center">{video ? <FileVideo className="size-9 text-muted-foreground" aria-hidden /> : <ImageIcon className="size-9 text-muted-foreground" aria-hidden />}</div>}
      <Badge variant="secondary" className="absolute top-3 left-3">{video ? <FileVideo /> : <ImageIcon />}{video ? "Video" : "Image"}</Badge>
      <span className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full border bg-card text-card-foreground"><Expand className="size-4" aria-hidden /></span>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
      <DialogHeader className="pr-8"><DialogTitle className="break-words">{asset.name}</DialogTitle><DialogDescription>{asset.mime}</DialogDescription></DialogHeader>
      {video
        ? <video controls preload="metadata" className="max-h-[64dvh] w-full rounded-lg bg-muted" src={source} />
        : <div className="relative h-[min(62dvh,36rem)] bg-muted"><Image src={source} alt={asset.name} fill unoptimized sizes="90vw" className="object-contain" /></div>}
      <DialogFooter showCloseButton><Button nativeButton={false} render={<a href={`/api/media/${asset.id}`} download />}>Download</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
