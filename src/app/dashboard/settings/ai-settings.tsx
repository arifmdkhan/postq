"use client";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

import { useId, useState, useTransition } from "react";
import { Bot, Check, CircleDot, FlaskConical, LoaderCircle, MoreHorizontal, Pencil, Plug, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldSelect } from "@/components/field-select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { saveModel, saveProvider, discoverProvider, providerOperation, modelOperation, type SettingsResult } from "@/features/settings/actions";
import type { AIModel } from "@/features/settings/provider";

export type PublicProvider = {
  id: string; name: string; kind: string; base_url: string | null;
  enabled: number; tested_at: number | null;
};
const providerLabels: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", "openai-compatible": "OpenAI-compatible" };
const emptyResult: SettingsResult = { message: "" };

function ProviderMark({ kind }: { kind: string }) {
  const Icon = kind === "anthropic" ? Sparkles : kind === "openai" ? Bot : Plug;
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/50"><Icon className="size-5" aria-hidden /></span>;
}

export function AISettings({ providers, models, serverModels }: { providers: PublicProvider[]; models: AIModel[]; serverModels: string[] }) {
  const [providerDialog, setProviderDialog] = useState<{ provider?: PublicProvider } | null>(null);
  const [modelDialog, setModelDialog] = useState<{ model?: AIModel; providerId?: string } | null>(null);
  const [removal, setRemoval] = useState<{ id: string; name: string; kind: "provider" | "model" } | null>(null);
  const [notice, setNotice] = useState(emptyResult);
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");
  const [providerPending, setProviderPending] = useState(false);
  const [modelPending, setModelPending] = useState(false);
  const visibleModels = models.filter((model) => {
    const provider = providers.find((item) => item.id === model.provider_id);
    return [model.label, model.model_id, provider?.name].join(" ").toLowerCase().includes(query.toLowerCase());
  });
  const run = (id: string, operation: "default" | "test" | "toggle") => {
    setBusyId(id);
    start(async () => setNotice(await modelOperation(id, operation)));
  };
  return <div className="grid gap-8">
    <section className="grid gap-4" aria-labelledby="providers-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="providers-heading" className="text-lg font-semibold">Provider connections <span className="ml-1 text-sm font-normal text-muted-foreground">{providers.length}</span></h2>
          <p className="text-sm text-muted-foreground">Connect your accounts once, then add the models you want to use.</p>
        </div>
        {providers.length > 0 && <Button variant="outline" onClick={() => setProviderDialog({})}><Plus />Add provider</Button>}
      </div>
      {notice.message && <Alert role={notice.error ? "alert" : "status"} variant={notice.error?"destructive":"default"}><AlertDescription>{notice.message}</AlertDescription></Alert>}
      {providers.length === 0 ? <Empty className="border border-dashed bg-card sm:p-12"><EmptyHeader><EmptyMedia variant="icon"><Plug /></EmptyMedia><EmptyTitle>Connect your first AI provider</EmptyTitle><EmptyDescription>Use OpenAI, Anthropic, or an OpenAI-compatible service with your own API key.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setProviderDialog({})}><Plus />Add provider</Button></EmptyContent>
      </Empty> : <div className="grid gap-3 xl:grid-cols-2">
        {providers.map((provider) => <Card role="article" key={provider.id} className="gap-0 py-0  grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderMark kind={provider.kind} />
              <div className="min-w-0"><h3 className="truncate font-semibold">{provider.name}</h3><p className="text-xs text-muted-foreground">{providerLabels[provider.kind]}</p></div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={"Manage " + provider.name} />}><MoreHorizontal /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setProviderDialog({ provider })}><Pencil />Edit connection</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setModelDialog({ providerId: provider.id })}><Plus />Add a model</DropdownMenuItem>
                  <DropdownMenuItem disabled={busy} onClick={() => { setBusyId(provider.id); start(async () => setNotice(await providerOperation(provider.id, "test"))); }}><Check />Check connection</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => setRemoval({ id: provider.id, name: provider.name, kind: "provider" })}><Trash2 />Remove provider</DropdownMenuItem></DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {provider.base_url && <p className="truncate text-xs text-muted-foreground" title={provider.base_url}>{provider.base_url}</p>}
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {busy && busyId === provider.id ? <LoaderCircle className="size-3 animate-spin" /> : <CircleDot className="size-3" />}
              {!provider.enabled ? "Disabled" : provider.tested_at ? "Connection verified" : "Credentials saved"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setModelDialog({ providerId: provider.id })}>
              <Plus />Add model<span className="text-muted-foreground">· {models.filter((model) => model.provider_id === provider.id).length}</span>
            </Button>
          </div>
        </Card>)}
      </div>}
    </section>

    <section className="grid gap-4" aria-labelledby="models-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1"><h2 id="models-heading" className="text-lg font-semibold">Models</h2>
          <p className="text-sm text-muted-foreground">Choose what appears in chat and set the default for writing with AI.</p></div>
        <Button disabled={!providers.length} onClick={() => setModelDialog({})}><Plus />Add model</Button>
      </div>
      {models.length > 0 && <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search models" placeholder="Search models or providers…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
      </div>}
      <Card className="gap-0 py-0 block overflow-hidden rounded-xl border bg-card">
        {visibleModels.length > 0 && <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_2rem] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
          <span>Model</span><span>Provider</span><span>Status</span><span className="sr-only">Actions</span>
        </div>}
        <ul className="divide-y">
          {visibleModels.map((model) => {
            const provider = providers.find((item) => item.id === model.provider_id);
            const enabled = Boolean(provider?.enabled && model.enabled);
            return <li key={model.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_2rem] md:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-medium">{model.label}</p>{model.is_default === 1 && <Badge variant="secondary">Default</Badge>}</div>
                <p className="mt-1 break-all text-xs text-muted-foreground">{model.model_id}</p>
                <p className="mt-1 text-xs text-muted-foreground md:hidden">{provider?.name} · {enabled ? model.tested_at ? "Tested" : "Ready" : "Disabled"}</p>
              </div>
              <p className="hidden truncate text-sm text-muted-foreground md:block">{provider?.name}</p>
              <span className="hidden text-xs text-muted-foreground md:block">{busy && busyId === model.id ? "Working…" : !provider?.enabled ? "Provider disabled" : !model.enabled ? "Disabled" : model.tested_at ? "Tested" : "Ready"}</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={"Manage model " + model.label} />}><MoreHorizontal /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setModelDialog({ model })}><Pencil />Model settings</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy || !enabled} onClick={() => run(model.id, "test")}><FlaskConical />Test model</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy || !enabled || Boolean(model.is_default)} onClick={() => run(model.id, "default")}><Check />Use as default</DropdownMenuItem>
                    <DropdownMenuItem disabled={busy} onClick={() => run(model.id, "toggle")}>{model.enabled ? "Disable model" : "Enable model"}</DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => setRemoval({ id: model.id, name: model.label, kind: "model" })}><Trash2 />Remove model</DropdownMenuItem></DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>;
          })}
          {visibleModels.length === 0 && <li className="grid justify-items-center gap-2 px-5 py-10 text-center">
            <Bot className="mb-1 size-7 text-muted-foreground" aria-hidden />
            <h3 className="font-medium">{query ? "No matching models" : "Add your first model"}</h3>
            <p className="max-w-sm text-sm text-muted-foreground">{query ? "Try another model or provider name." : providers.length ? "Choose a connected provider and add one model at a time." : "Connect a provider above to get started."}</p>
          </li>}
        </ul>
      </Card>
      <p className="text-xs text-muted-foreground">Testing a model sends a small request and may incur provider charges.</p>
      {serverModels.length > 0 && <details className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">Models configured on the server · {serverModels.length}</summary>
        <p className="mt-2">These also appear in the assistant. Manage their configuration in the server environment.</p>
        <ul className="mt-2 grid gap-1">{serverModels.map((id) => <li key={id} className="break-all font-mono text-xs">{id}</li>)}</ul>
      </details>}
    </section>

    <Dialog open={Boolean(providerDialog)} onOpenChange={(open) => { if (!open && !providerPending) setProviderDialog(null); }}>
      <DialogContent showCloseButton={!providerPending} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg">
        <DialogHeader><DialogTitle>{providerDialog?.provider ? "Edit provider connection" : "Add AI provider"}</DialogTitle>
          <DialogDescription>Save the account credentials for this connection. Add its models separately.</DialogDescription></DialogHeader>
        {providerDialog && <ProviderForm key={providerDialog.provider?.id ?? "new-provider"} provider={providerDialog.provider} onBusy={setProviderPending}
          onSaved={(result) => { setNotice(result); setProviderDialog(null); }} />}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(modelDialog)} onOpenChange={(open) => { if (!open && !modelPending) setModelDialog(null); }}>
      <DialogContent showCloseButton={!modelPending} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-lg">
        <DialogHeader><DialogTitle>{modelDialog?.model ? "Model settings" : "Add a model"}</DialogTitle>
          <DialogDescription>{modelDialog?.model ? "Manage this model’s display name and availability." : "Choose one model from a provider or enter its model ID."}</DialogDescription></DialogHeader>
        {modelDialog && <ModelForm key={modelDialog.model?.id ?? modelDialog.providerId ?? "new-model"} providers={providers} model={modelDialog.model} providerId={modelDialog.providerId} onBusy={setModelPending}
          onSaved={(result) => { setNotice(result); setModelDialog(null); }} />}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(removal)} onOpenChange={(open) => { if (!open && !busy) setRemoval(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Remove {removal?.name}?</DialogTitle>
          <DialogDescription>{removal?.kind === "provider" ? "This removes the saved connection and all of its models from PostQ." : "This model will be removed from the assistant’s choices."}</DialogDescription></DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => {
            if (!removal) return;
            const target = removal;
            start(async () => {
              const result = target.kind === "provider" ? await providerOperation(target.id, "delete") : await modelOperation(target.id, "delete");
              setNotice(result);
              if (!result.error) setRemoval(null);
            });
          }}>{busy ? "Removing…" : "Remove"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function ProviderForm({ provider, onSaved, onBusy }: { provider?: PublicProvider; onSaved: (result: SettingsResult) => void; onBusy: (busy: boolean) => void }) {
  const prefix = useId();
  const [kind, setKind] = useState(provider?.kind ?? "openai");
  const [result, setResult] = useState(emptyResult);
  const [pending, start] = useTransition();
  return <form action={(form) => start(async () => {
    onBusy(true);
    try {
      const response = await saveProvider(provider?.id ?? null, emptyResult, form);
      setResult(response);
      if (!response.error) onSaved(response);
    } catch { setResult({ message: "Couldn’t save the connection. Try again.", error: true }); }
    finally { onBusy(false); }
  })}>
    <FieldGroup>
      <Field><FieldLabel htmlFor={prefix + "-kind"}>Provider</FieldLabel>
        <FieldSelect id={prefix + "-kind"} name="kind" value={kind} onValueChange={setKind} disabled={pending}
          className="w-full" options={Object.entries(providerLabels).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field><FieldLabel htmlFor={prefix + "-name"}>Connection name</FieldLabel><Input id={prefix + "-name"} name="name" defaultValue={provider?.name}
        placeholder={kind === "openai-compatible" ? "e.g. NVIDIA" : "e.g. My " + providerLabels[kind] + " account"} required maxLength={80} disabled={pending} /></Field>
      {kind === "openai-compatible" && <Field><FieldLabel htmlFor={prefix + "-base"}>API base URL</FieldLabel><Input id={prefix + "-base"} name="base" type="url"
        defaultValue={provider?.base_url ?? ""} placeholder="https://api.example.com/v1" required disabled={pending} /><FieldDescription>Include the API path supplied by your provider.</FieldDescription></Field>}
      <Field><FieldLabel htmlFor={prefix + "-key"}>API key</FieldLabel><Input id={prefix + "-key"} name="key" type="password" autoComplete="off" spellCheck={false}
        placeholder={provider ? "Leave blank to keep your saved key" : "Paste your API key"} required={!provider} maxLength={4096} disabled={pending} />
        <FieldDescription>Encrypted on the server. Saved keys are never displayed here.</FieldDescription></Field>
      {provider && <Field orientation="horizontal"><Checkbox id={prefix + "-enabled"} name="enabled" value="yes" defaultChecked={Boolean(provider.enabled)} disabled={pending} />
        <FieldLabel htmlFor={prefix + "-enabled"}>Enable this connection</FieldLabel></Field>}
      {!provider && <input type="hidden" name="enabled" value="yes" />}
      {result.error && <FieldError role="alert">{result.message}</FieldError>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}{provider ? "Save connection" : "Add provider"}</Button>
      </DialogFooter>
    </FieldGroup>
  </form>;
}

function ModelForm({ providers, model, providerId, onSaved, onBusy }: {
  providers: PublicProvider[]; model?: AIModel; providerId?: string; onSaved: (result: SettingsResult) => void; onBusy: (busy: boolean) => void;
}) {
  const prefix = useId();
  const [selectedProvider, setSelectedProvider] = useState(model?.provider_id ?? providerId ?? providers[0]?.id ?? "");
  const [manual, setManual] = useState(Boolean(model));
  const [modelId, setModelId] = useState(model?.model_id ?? "");
  const [catalog, setCatalog] = useState<string[]>([]);
  const [result, setResult] = useState(emptyResult);
  const [discovery, setDiscovery] = useState(emptyResult);
  const [pending, start] = useTransition();
  const [loading, load] = useTransition();
  const provider = providers.find((item) => item.id === selectedProvider);
  return <form action={(form) => start(async () => {
    onBusy(true);
    try {
      const response = await saveModel(model?.id ?? null, emptyResult, form);
      setResult(response);
      if (!response.error) onSaved(response);
    } catch { setResult({ message: "Couldn’t save the model. Try again.", error: true }); }
    finally { onBusy(false); }
  })}>
    <FieldGroup>
      <Field><FieldLabel htmlFor={prefix + "-provider"}>Provider connection</FieldLabel>
        <FieldSelect id={prefix + "-provider"} name="provider" value={selectedProvider} disabled={pending || loading || Boolean(model)} className="w-full"
          onValueChange={(value) => { setSelectedProvider(value); setModelId(""); setCatalog([]); setDiscovery(emptyResult); }}
          options={providers.map(({ id, name, enabled }) => ({ value: id, label: name + (enabled ? "" : " (disabled)") }))} />
      </Field>
      <Field><FieldLabel htmlFor={prefix + "-model"}>Model ID</FieldLabel>
        {manual ? <Input id={prefix + "-model"} name="model" value={modelId} onChange={(event) => setModelId(event.target.value)}
          placeholder="Exact model ID from your provider" readOnly={Boolean(model)} maxLength={200} required disabled={pending} /> :
          <FieldSelect id={prefix + "-model"} name="model" value={modelId} onValueChange={setModelId} disabled={pending || loading || !catalog.length} required className="w-full"
            options={[{ value: "", label: loading ? "Loading models…" : "Select a model" }, ...catalog.map((id) => ({ value: id, label: id }))]} />}
        {!model && <div className="flex flex-wrap gap-2">
          {!manual && <Button type="button" variant="outline" size="sm" disabled={!selectedProvider || pending || loading} onClick={() => {
            const requestedProvider = selectedProvider;
            load(async () => {
              const response = await discoverProvider(requestedProvider);
              setDiscovery(response);
              setCatalog(response.models ?? []);
            });
          }}>{loading && <LoaderCircle className="animate-spin" />}{catalog.length ? "Refresh model list" : "Load provider models"}</Button>}
          <Button type="button" variant="ghost" size="sm" disabled={pending || loading} onClick={() => { setManual(!manual); setModelId(""); }}>
            {manual ? "Choose from provider" : "Enter model ID manually"}
          </Button>
        </div>}
        {discovery.error && <FieldDescription>{discovery.message} You can enter the model ID manually.</FieldDescription>}
      </Field>
      <Field><FieldLabel htmlFor={prefix + "-label"}>Display name <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
        <Input id={prefix + "-label"} name="label" defaultValue={model?.label === model?.model_id ? "" : model?.label} maxLength={100} placeholder={modelId || "Use the model ID"} disabled={pending} />
        <FieldDescription>This name appears in the assistant’s model picker.</FieldDescription></Field>
      <Field orientation="horizontal"><Checkbox id={prefix + "-enabled"} name="enabled" value="yes" defaultChecked={model ? Boolean(model.enabled) : true} disabled={pending} />
        <FieldLabel htmlFor={prefix + "-enabled"}>Available in the assistant</FieldLabel></Field>
      {provider?.enabled === 0 && <FieldDescription>Enable this provider connection before using its models.</FieldDescription>}
      {result.error && <FieldError role="alert">{result.message}</FieldError>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending || loading || !modelId || !provider}>{pending && <LoaderCircle className="animate-spin" />}{model ? "Save model" : "Add model"}</Button>
      </DialogFooter>
    </FieldGroup>
  </form>;
}
