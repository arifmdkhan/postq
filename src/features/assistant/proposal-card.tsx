"use client";
import { useFormStatus } from "react-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker, TimePicker } from "@/components/date-time-picker";
import { applyDraftRevision, saveCampaign } from "./actions";
import type { PostProposal } from "./chat-types";

function SaveProposal({ proposal, disabled }: { proposal: PostProposal; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending} className="w-full sm:w-fit">
    {pending ? "Saving…" : proposal.edit ? "Apply revision and review" : proposal.campaign.length === 1 ? "Save draft and review" : `Save ${proposal.campaign.length} drafts and review`}
  </Button>;
}
export function ProposalCard({ proposal, disabled }: { proposal: PostProposal; disabled: boolean }) {
  return <Card className="my-4 overflow-hidden">
    <CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle>{proposal.edit ? `Revision: ${proposal.edit.title}` : "Post proposal"}</CardTitle><Badge variant="secondary">Needs review</Badge></div>
      <CardDescription>Edit the copy, then save to review accounts, media, and scheduling in the composer.</CardDescription></CardHeader>
    <CardContent><form action={proposal.edit ? applyDraftRevision.bind(null, proposal.edit.id, proposal.edit.updatedAt, proposal.campaign[0].id)
      : saveCampaign.bind(null, proposal.campaign.map(({ id }) => id))}>
      <FieldGroup>{proposal.campaign.map((post, index) => <details key={post.id} open={index === 0} className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">{post.title}</summary>
        <FieldGroup className="mt-4 gap-4">
          <Field><FieldLabel htmlFor={post.id + "-title"}>Title</FieldLabel><Input id={post.id + "-title"} name={post.id + "-title"} defaultValue={post.title} maxLength={160} required /></Field>
          <Field><FieldLabel htmlFor={post.id + "-caption"}>Caption</FieldLabel><Textarea id={post.id + "-caption"} name={post.id + "-caption"} defaultValue={post.caption} maxLength={9600} required /></Field>
          {Object.entries(post.variants).map(([platform, caption]) => <Field key={platform}><FieldLabel htmlFor={post.id + "-" + platform} className="capitalize">{platform === "x" ? "X" : platform} variant</FieldLabel><Textarea id={post.id + "-" + platform} name={post.id + "-" + platform} defaultValue={caption} maxLength={10000} /></Field>)}
          <div className="grid gap-3 sm:grid-cols-2"><DatePicker label="Suggested local date" name={post.id + "-date"} defaultValue={post.date} /><TimePicker label="Suggested local time" name={post.id + "-time"} defaultValue={post.time} /></div>
        </FieldGroup>
      </details>)}<SaveProposal proposal={proposal} disabled={disabled} /><p className="text-xs text-muted-foreground">This saves a draft. Publishing requires approval in the composer.</p></FieldGroup>
    </form></CardContent>
  </Card>;
}
