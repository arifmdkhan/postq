import Link from "next/link";
import { Suspense } from "react";
import SettingsLoading from "./loading";
import { ArrowUpRight, Cloud, KeyRound, Plug, ShieldCheck } from "lucide-react";
import { requireUser } from "@/server/auth";
import { database } from "@/server/db";
import { runtimeConfiguration } from "@/features/settings/configuration";
import { modelRecords, providerRecords } from "@/features/settings/providers";
import { environmentModels } from "@/features/assistant/model";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IntegrationForm, PasswordSettings, GoogleLink, WorkerSync, TimezoneSettings } from "./forms";
import { workspaceTimezonePreferences } from "@/features/settings/timezone";
import { SettingsTabs } from "./settings-tabs";
import { AISettings } from "./ai-settings";
import { MCPSettings } from "./mcp-settings";
import type { MCPToken } from "@/features/mcp/access";

type SettingsProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default function SettingsPage({ searchParams }: SettingsProps) {
  return <Suspense fallback={<SettingsLoading />}><Settings searchParams={searchParams} /></Suspense>;
}
async function Settings({ searchParams }: SettingsProps) {
  const user = await requireUser();
  const timezonePreferences = await workspaceTimezonePreferences();
  const displayTime=new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:timezonePreferences.timezone});
  const db = await database();
  const scheduler = await db.prepare("SELECT value,updated_at FROM app_settings WHERE name='scheduler-status'").first<{value:string;updated_at:number}>();
  let schedulerStatus = "Unknown; check Worker logs.";
  try {
    const status = JSON.parse(scheduler?.value ?? "{}").status;
    const names: Record<string,string> = {ready:"Running",paused:"Publishing paused",not_configured:"Connect Composio to publish",credentials_need_repair:"Repair publishing credentials",no_owner:"Create the workspace owner"};
    if (typeof status === "string") schedulerStatus = names[status] ?? "Last run failed; check Worker logs and delivery errors.";
  } catch { /* Preserve access to Settings when a diagnostic record is damaged. */ }
  const queueHealth = await db.prepare("SELECT min(CASE WHEN status='scheduled' THEN due_at END) AS oldest_due,sum(status='review') AS needs_review FROM publications WHERE user_id=?")
    .bind(user.id).first<{oldest_due:number|null;needs_review:number|null}>();
  const [config, providers, models, { results: accounts }, params, sync, { results: mcpTokens }, { results: mcpRequests }, now] = await Promise.all([
    runtimeConfiguration(db), providerRecords(), modelRecords(),
    db.prepare("SELECT providerId, CASE WHEN providerId='credential' AND password IS NOT NULL THEN 1 ELSE 0 END AS has_password FROM account WHERE userId=?")
      .bind(user.id).all<{ providerId: string; has_password: number }>(),
    searchParams, db.prepare("SELECT updated_at FROM app_settings WHERE name='worker-sync-status'").first<{ updated_at: number }>(),
    db.prepare("SELECT id,name,scopes,created_at,expires_at,revoked_at,last_used_at FROM mcp_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.id).all<MCPToken>(),
    db.prepare(`SELECT r.id,r.kind,CASE WHEN r.state='pending' AND (t.revoked_at IS NOT NULL OR MIN(r.expires_at,t.expires_at)<=CAST(strftime('%s','now') AS INTEGER)*1000)
      THEN 'expired' ELSE r.state END AS state,r.created_at FROM mcp_requests r JOIN mcp_tokens t ON t.id=r.token_id
      WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 10`).bind(user.id).all<{ id: string; kind: string; state: string; created_at: number }>(),
    db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 AS now").first<number>("now"),
  ]);
  const google = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
  const linked = accounts.some(({ providerId }) => providerId === "google");
  const hasPassword = accounts.some(({ has_password }) => has_password === 1);
  const fields = (names: { name: string; label: string; secret?: boolean }[]) => names.map((field) => ({
    ...field, configured: Boolean(config[field.name]), value: field.secret ? undefined : config[field.name],
  }));
  const tab = typeof params.tab === "string" && ["security", "models", "integrations", "deployment"].includes(params.tab) ? params.tab : "security";
  return <section className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-7">
    <header className="grid gap-2">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground sm:text-base">Your account, AI connections, and publishing workspace.</p>
    </header>
    <Card><CardHeader><CardTitle>Publishing health</CardTitle><CardDescription>Scheduler and queued deliveries</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm">
      <p>Last scheduler update: {scheduler ? displayTime.format(scheduler.updated_at)+" "+timezonePreferences.timezone : "No run recorded. Check the Worker cron trigger."}</p>
      {scheduler && <p>Status: {schedulerStatus}{(now ?? 0)-scheduler.updated_at>5*60000 ? " · No update in over five minutes; check the cron trigger." : ""}</p>}
      <p>{queueHealth?.needs_review??0} deliveries need review.</p>
      {queueHealth?.oldest_due!=null && <p>Oldest queued delivery: {displayTime.format(queueHealth.oldest_due)} {timezonePreferences.timezone}</p>}
    </CardContent></Card>
    {config.POSTQ_CONFIG_ERRORS && <Alert variant="destructive"><AlertTitle>Saved credentials need repair</AlertTitle><AlertDescription>Could not decrypt {config.POSTQ_CONFIG_ERRORS}. Restore the encryption key or re-enter those credentials below. Password sign-in remains available.</AlertDescription></Alert>}
    {params.welcome === "1" && <Alert><ShieldCheck /><AlertTitle>Welcome to your studio</AlertTitle><AlertDescription>Add Google sign-in for another way to access your account, then connect an AI provider and your social accounts.</AlertDescription></Alert>}
    {params.google === "failed" && <Alert variant="destructive"><AlertTitle>Google linking didn’t finish</AlertTitle><AlertDescription>Check your client credentials and use the same email as your owner account.</AlertDescription></Alert>}
    <SettingsTabs initialTab={tab}>
      <TabsContent value="security" className="grid gap-5">
        <Card><CardHeader><CardTitle>Calendar timezone</CardTitle></CardHeader><CardContent><TimezoneSettings {...timezonePreferences} /></CardContent></Card>
        <div className="grid gap-1"><h2 className="text-lg font-semibold">Login & security</h2><p className="text-sm text-muted-foreground">Manage how you access your workspace.</p></div>
        <Card>
          <CardHeader><CardTitle>Workspace owner</CardTitle><CardDescription>This account manages PostQ and its service connections.</CardDescription></CardHeader>
          <CardContent><div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-lg font-medium" aria-hidden>{user.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0"><p className="font-medium">{user.name}</p><p className="break-all text-sm text-muted-foreground">{user.email}</p></div>
            <Badge variant="outline" className="ml-auto">Owner</Badge>
          </div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sign-in methods</CardTitle><CardDescription>Keep your password secure and add an optional Google connection.</CardDescription></CardHeader>
          <CardContent className="grid divide-y">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
              <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border"><KeyRound className="size-4" aria-hidden /></span>
                <div className="grid gap-1"><p className="text-sm font-medium">Email & password</p><p className="text-xs text-muted-foreground">{hasPassword ? "Password is set for your owner account." : "Set a password to sign in with your email."}</p></div>
              </div>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>{hasPassword ? "Change password" : "Set password"}</DialogTrigger>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg">
                  <DialogHeader><DialogTitle>{hasPassword ? "Change password" : "Set a password"}</DialogTitle><DialogDescription>Use a strong password for {user.email}.</DialogDescription></DialogHeader>
                  <PasswordSettings hasPassword={hasPassword} email={user.email} />
                </DialogContent>
              </Dialog>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4 pt-5">
              <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border"><ShieldCheck className="size-4" aria-hidden /></span>
                <div className="grid gap-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">Google sign-in</p><Badge variant="secondary">{linked ? "Linked" : google ? "Ready to connect" : "Optional"}</Badge></div>
                  <p className="max-w-md text-xs text-muted-foreground">Use your Google account for another way to sign in. Enable 2-Step Verification on that account.</p></div>
              </div>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>{google ? "Configure" : "Set up Google"}</DialogTrigger>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg">
                  <DialogHeader><DialogTitle>Configure Google sign-in</DialogTitle><DialogDescription>Use a Web application OAuth client from your Google Cloud project.</DialogDescription></DialogHeader>
                  <details className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Where do I get these credentials?</summary>
                    <ol className="mt-3 grid list-decimal gap-2 pl-4 text-muted-foreground">
                      <li>Create a Web application OAuth client in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-primary underline">Google Cloud Console</a>.</li>
                      <li>Add this authorized redirect URI.<code className="mt-1 block break-all rounded-md bg-background p-2 text-xs text-foreground select-all">{new URL("/api/auth/callback/google", process.env.BETTER_AUTH_URL ?? "http://localhost:3000").href}</code></li>
                      <li>Save the credentials, then connect the Google account using {user.email}.</li>
                    </ol>
                  </details>
                  <IntegrationForm section="google" fields={fields([{ name: "GOOGLE_CLIENT_ID", label: "Google client ID" }, { name: "GOOGLE_CLIENT_SECRET", label: "Google client secret", secret: true }])} />
                </DialogContent>
              </Dialog>
              {google && !linked && <div className="w-full"><GoogleLink /></div>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="models">
        <AISettings providers={providers.map(({ id, name, kind, base_url, enabled, tested_at }) => ({ id, name, kind, base_url, enabled, tested_at }))} models={models} serverModels={environmentModels()} />
      </TabsContent>
      <TabsContent value="integrations" className="grid gap-5">
        <MCPSettings endpoint={new URL("/mcp", process.env.BETTER_AUTH_URL).toString()} tokens={mcpTokens} requests={mcpRequests} now={now ?? 0} timezone={timezonePreferences.timezone} />
        <div className="grid gap-1"><h2 className="text-lg font-semibold">Publishing integrations</h2><p className="text-sm text-muted-foreground">Configure the service that connects your social accounts.</p></div>
        <Card>
          <CardHeader className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-xl border bg-muted/50"><Plug className="size-5" aria-hidden /></span>
              <div className="grid gap-2"><CardTitle>Composio</CardTitle><CardDescription>Authorization and publishing for your connected accounts.</CardDescription><Badge variant="secondary">{config.COMPOSIO_API_KEY ? "Configured" : "Setup required"}</Badge></div>
            </div>
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>Configure Composio</DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg">
                <DialogHeader><DialogTitle>Configure Composio</DialogTitle><DialogDescription>Save your project key and any custom account authorization configurations.</DialogDescription></DialogHeader>
                <IntegrationForm section="composio" fields={fields([
                  { name: "COMPOSIO_API_KEY", label: "Composio project API key", secret: true },
                  { name: "COMPOSIO_AUTH_CONFIG_THREADS", label: "Threads auth config ID (optional)" },
                  { name: "COMPOSIO_AUTH_CONFIG_TIKTOK", label: "TikTok auth config ID (optional)" },
                  { name: "COMPOSIO_AUTH_CONFIG_TWITTER", label: "X auth config ID (optional)" },
                ])} />
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent><Link href="/dashboard/publishing" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Manage social accounts<ArrowUpRight className="size-4" /></Link></CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="deployment" className="grid gap-5">
        <div className="grid gap-1"><h2 className="text-lg font-semibold">Deployment</h2><p className="text-sm text-muted-foreground">Apply saved credentials to your Cloudflare Worker.</p></div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cloud className="size-5" />Worker configuration</CardTitle><CardDescription>Saved settings apply to this workspace immediately. Sync them to update Worker secrets and variables.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <WorkerSync worker={process.env.POSTQ_CLOUDFLARE_WORKER ?? ""} configured={Boolean(process.env.POSTQ_CLOUDFLARE_API_TOKEN && process.env.POSTQ_CLOUDFLARE_ACCOUNT_ID && process.env.POSTQ_CLOUDFLARE_WORKER)} />
            {sync && <p className="text-xs text-muted-foreground">Last confirmed update · {new Date(sync.updated_at).toISOString()}</p>}
            <details className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Deployment connection details</summary>
              <p className="mt-3">Configure POSTQ_CLOUDFLARE_API_TOKEN, POSTQ_CLOUDFLARE_ACCOUNT_ID, and POSTQ_CLOUDFLARE_WORKER on the server. Use a token limited to the target account with Workers Scripts Write permission.</p>
            </details>
          </CardContent>
        </Card>
      </TabsContent>
    </SettingsTabs>
  </section>;
}
