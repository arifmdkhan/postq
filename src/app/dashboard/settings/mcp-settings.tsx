"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, LoaderCircle, Plus, Unplug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/field-select";
import { createMCPToken, revokeMCPToken } from "@/features/mcp/actions";
import type { MCPToken } from "@/features/mcp/access";
const scopeLabels: Record<string, string> = { read: "Read workspace", "drafts:write": "Edit drafts", "schedule:request": "Request scheduling" };

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setError(false); } catch { setError(true); }
  }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : label}</Button>{error && <span role="status" className="text-xs text-muted-foreground">Select and copy the text manually.</span>}</div>;
}

export function MCPSettings({ endpoint, tokens, requests, now,timezone }: {
  endpoint: string; tokens: MCPToken[]; requests: { id: string; kind: string; state: string; created_at: number }[]; now: number;timezone:string;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [revoke, setRevoke] = useState<MCPToken | null>(null);
  const displayTime=new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:timezone});
  const codex = `codex mcp add postq --url ${endpoint} --bearer-token-env-var POSTQ_MCP_TOKEN`;
  const claude = JSON.stringify({ mcpServers: { postq: { type: "http", url: endpoint, headers: { Authorization: "Bearer ${POSTQ_MCP_TOKEN}" } } } }, null, 2);
  return <Card>
    <CardHeader className="flex flex-wrap items-start justify-between gap-4"><div className="grid gap-2">
      <CardTitle className="flex items-center gap-2"><KeyRound className="size-5" />Claude & Codex · MCP</CardTitle>
      <CardDescription>Manage your workspace from external AI assistants using scoped access tokens.</CardDescription></div>
      <Button variant="outline" onClick={() => { setOpen(true); setToken(""); setError(""); }}><Plus />Create access token</Button>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-5">
      <div className="grid gap-2"><p className="text-sm font-medium">MCP endpoint</p><code className="break-all rounded-lg border bg-muted/30 px-3 py-2 text-xs">{endpoint}</code><CopyValue value={endpoint} label="Copy endpoint" /></div>
      <p className="text-sm text-muted-foreground">Read data and edit drafts through your chosen assistant. Scheduling, rescheduling, and cancellation requests require your approval in PostQ.</p>
      <div className="divide-y rounded-xl border">
        {tokens.length === 0 && <p className="p-4 text-sm text-muted-foreground">No access tokens yet. Create a separate token for each client.</p>}
        {tokens.map((item) => <div key={item.id} role="group" aria-label={"Access token " + item.name} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="grid min-w-0 gap-1"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-medium">{item.name}</p>
            <Badge variant="secondary">{item.revoked_at ? "Revoked" : item.expires_at <= now ? "Expired" : "Active"}</Badge></div>
            <p className="text-xs text-muted-foreground">{(JSON.parse(item.scopes) as string[]).map((scope) => scopeLabels[scope] ?? scope).join(" · ")}</p>
            <p className="text-xs text-muted-foreground">Expires {displayTime.format(item.expires_at)} {timezone} · {item.last_used_at ? "Last used " + displayTime.format(item.last_used_at) + " " + timezone : "Not used yet"}</p>
          </div>
          {!item.revoked_at && item.expires_at > now && <Button variant="outline" size="sm" onClick={() => { setError(""); setRevoke(item); }}><Unplug />Revoke</Button>}
        </div>)}
      </div>
      <details className="min-w-0 rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Connect Claude Code or Codex</summary>
        <div className="mt-4 grid min-w-0 gap-4 text-sm">
          <p>Set <code>POSTQ_MCP_TOKEN</code> in the environment used to start your client. Keep its value out of source control.</p>
          <div className="grid gap-2"><h3 className="font-medium">Codex</h3><pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{codex}</code></pre><CopyValue value={codex} label="Copy Codex command" /></div>
          <div className="grid gap-2"><h3 className="font-medium">Claude Code</h3><p className="text-muted-foreground">Merge this into your private MCP configuration. Claude expands the environment variable when connecting.</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{claude}</code></pre><CopyValue value={claude} label="Copy Claude configuration" /></div>
          <p className="text-xs text-muted-foreground">This endpoint uses access tokens, not an OAuth login flow. You do not need an OpenAI or Anthropic API key in PostQ for external MCP access.</p>
        </div>
      </details>
      {requests.length > 0 && <div className="grid gap-2"><h3 className="text-sm font-medium">Recent action requests</h3><ul className="divide-y rounded-lg border">{requests.map((request) => <li key={request.id}>
        <Link href={"/dashboard/mcp-review?request=" + request.id} className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent"><span className="capitalize">{request.kind} request</span><Badge variant="outline">{request.state}</Badge></Link>
      </li>)}</ul></div>}
      <Dialog open={open} onOpenChange={(value) => { if (!pending || token) { setOpen(value); if (!value) setToken(""); } }}>
        <DialogContent showCloseButton={!pending || Boolean(token)} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6">
          <DialogHeader><DialogTitle>{token ? "Save your access token" : "Create MCP access token"}</DialogTitle><DialogDescription>{token ? "This token is displayed once. PostQ stores only its hash." : "Give this client only the access it needs."}</DialogDescription></DialogHeader>
          {token ? <FieldGroup><Alert><AlertTitle>Copy before closing</AlertTitle><AlertDescription>Store this as POSTQ_MCP_TOKEN for your Claude or Codex client.</AlertDescription></Alert>
            <Field><FieldLabel htmlFor="new-mcp-token">Access token</FieldLabel><Input id="new-mcp-token" type="password" value={token} readOnly autoComplete="off" /><CopyValue value={token} label="Copy access token" /></Field>
            <DialogFooter><DialogClose render={<Button />}>Done</DialogClose></DialogFooter></FieldGroup> :
            <form action={(form) => start(async () => {
              setError("");
              try { const result = await createMCPToken(form); if (result.token) setToken(result.token); else setError(result.error ?? "Couldn’t create token."); }
              catch { setError("Couldn’t create the token. Try again."); }
            })}><FieldGroup>
              <Field><FieldLabel htmlFor="mcp-token-name">Token name</FieldLabel><Input id="mcp-token-name" name="name" placeholder="e.g. Claude on my laptop" required maxLength={80} disabled={pending} /></Field>
              <Field><FieldLabel htmlFor="mcp-token-level">Permissions</FieldLabel><FieldSelect id="mcp-token-level" name="level" defaultValue="read" disabled={pending} className="w-full" options={[
                { value: "read", label: "Read workspace data" }, { value: "drafts", label: "Read and edit drafts" }, { value: "manage", label: "Read, edit drafts, and request scheduling changes" },
              ]} /><FieldDescription>Scheduling changes always need your approval in PostQ.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="mcp-token-expiry">Expires after</FieldLabel><FieldSelect id="mcp-token-expiry" name="days" defaultValue="30" disabled={pending} className="w-full" options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} /></Field>
              {error && <FieldError role="alert">{error}</FieldError>}
              <DialogFooter><DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Create token</Button></DialogFooter>
            </FieldGroup></form>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(revoke)} onOpenChange={(value) => { if (!value && !pending) setRevoke(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Revoke {revoke?.name}?</DialogTitle><DialogDescription>The client will lose access. Pending requests made with this token cannot be approved.</DialogDescription></DialogHeader>
          {error && <FieldError role="alert">{error}</FieldError>}
          <DialogFooter><DialogClose render={<Button variant="outline" disabled={pending} />}>Keep token</DialogClose><Button variant="destructive" disabled={pending} onClick={() => start(async () => {
            try { if (revoke) await revokeMCPToken(revoke.id); setRevoke(null); }
            catch { setError("Couldn’t revoke access. Try again."); }
          })}>Revoke access</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
