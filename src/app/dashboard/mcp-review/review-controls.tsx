"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { reviewMCPRequest } from "@/features/mcp/actions";

export function ReviewControls({ id, ready, kind }: { id: string; ready: boolean; kind: string }) {
  const [result, action, pending] = useActionState(async (_previous: { message: string; done?: boolean; error?: boolean }, form: FormData) =>
    reviewMCPRequest(id, form.get("decision") === "approve"), { message: "" });
  return <form action={action} className="grid gap-4">
    {result.message && <Alert variant={result.error ? "destructive" : "default"}><AlertDescription>{result.message}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3"><Button name="decision" value="approve" type="submit" disabled={!ready || pending || result.done}>
      {pending ? "Applying request…" : kind === "schedule" ? "Approve and schedule" : kind === "cancel" ? "Approve cancellation" : "Approve reschedule"}</Button>
      <Button name="decision" value="reject" type="submit" variant="outline" disabled={!ready || pending || result.done}>Reject request</Button></div>
  </form>;
}
