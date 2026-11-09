"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { mediaTypes } from "./formats";
import { uploadMediaFile } from "./upload";

export function UploadDialog({ folder, variant = "default" }: { folder: string; variant?: "default" | "outline" }) {
  const inputId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const select = (incoming: FileList | null) => {
    setError("");
    if (incoming && incoming.length > 35) {setError("Choose up to 35 files at once. No files were added.");return;}
    setFiles(Array.from(incoming ?? []));
  };
  async function upload(form: FormData) {
    if (!files.length || progress) return;
    let complete = 0;
    const failures: string[] = [];
    const failed: File[]=[];
    setError("");
    for (const [index, file] of files.entries()) {
      setProgress(`Uploading ${index + 1} of ${files.length}…`);
      try {
        await uploadMediaFile(file, String(form.get("folder") ?? ""));
        complete++;
      } catch (error) {
        failed.push(file);
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "Upload failed."}`);
      }
    }
    setProgress("");
    setFiles(failed);
    if (complete) {
      setNotice(`${complete} ${complete === 1 ? "file" : "files"} added.`);
      router.refresh();
    }
    if (failures.length) setError(failures.join("\n"));
    else setOpen(false);
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Dialog open={open} onOpenChange={(next) => {
      if (progress) return;
      if (next) { setNotice(""); setError(""); setFiles([]); }
      setOpen(next);
    }}>
      <DialogTrigger render={<Button variant={variant} size="lg" className="min-h-11" />}>
        <Upload data-icon="inline-start" />Upload media
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!progress}>
        <DialogHeader><DialogTitle>Upload media</DialogTitle><DialogDescription>Add images and videos to your private library.</DialogDescription></DialogHeader>
        <form action={upload}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={inputId} className="sr-only">Choose media files</FieldLabel>
              <div data-dragging={dragging || undefined} className="rounded-xl border border-dashed bg-muted/30 p-5 text-center data-[dragging]:border-primary data-[dragging]:bg-accent"
                onDragOver={(event) => { event.preventDefault(); if (!progress) setDragging(true); }}
                onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!progress) select(event.dataTransfer.files); }}>
                <CloudUpload className="mx-auto mb-2 size-7 text-primary" aria-hidden />
                <p className="font-medium">Drop files here or browse</p>
                <p className="mb-3 text-xs text-muted-foreground">Up to 35 files · JPEG, PNG, WebP, GIF, MP4, WebM · 10 MiB per file · Up to 6 megapixels. MP4 requires H.264 with optional AAC audio.</p>
                <Input id={inputId} type="file" multiple accept={mediaTypes.join(",")} disabled={Boolean(progress)} onChange={(event) => select(event.target.files)} />
              </div>
              {files.length > 0 && <ul aria-label="Selected files" className="max-h-24 overflow-auto text-sm">
                {files.map((file, index) => <li className="truncate" key={file.name + index}>{file.name}</li>)}
              </ul>}
            </Field>
            <Field><FieldLabel>Folder<Input name="folder" maxLength={80} defaultValue={folder} placeholder="Unfiled" /></FieldLabel></Field>
            {error && <FieldError className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{error}</FieldError>}
            {progress&&<p role="status" className="break-words text-sm">{progress}</p>}
            <DialogFooter showCloseButton={!progress}>
              <Button type="submit" disabled={!files.length || Boolean(progress)}>{progress || (files.length ? `Upload ${files.length} ${files.length === 1 ? "file" : "files"}` : "Upload files")}</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
    <span role="status" className="text-sm text-muted-foreground">{notice}</span>
  </div>;
}
