"use client";
import { useActionState, useMemo, useState, useTransition } from "react";
import { createAuthClient } from "better-auth/react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { useDeviceTimezone } from "@/features/settings/local-timezone";
import { Check, LoaderCircle } from "lucide-react";
import { passwordRules } from "@/server/password";
import { saveIntegrations, testComposioSettings, setOwnerPassword, syncWorkerSettings, saveTimezone, type SettingsResult } from "@/features/settings/actions";
const initial: SettingsResult = { message: "" };

export function TimezoneSettings({ timezone,mode,ready }: { timezone:string;mode:"auto"|"manual";ready:boolean }) {
  const [result, action, pending] = useActionState(saveTimezone, initial);
  const detected=useDeviceTimezone();
  const [automatic,setAutomatic]=useState(mode==="auto");
  const [manual,setManual]=useState(ready?timezone:"");
  const [edited,setEdited]=useState(false);
  const zones=useMemo(()=>{
    let supported:string[]=[];
    try{supported=Intl.supportedValuesOf("timeZone");}catch{supported=["Asia/Kolkata","America/New_York","Europe/London","Asia/Tokyo","Australia/Sydney"];}
    return [...new Set(["UTC",timezone,...(detected?[detected]:[]),...supported])].sort();
  },[timezone,detected]);
  return <form action={action} onSubmit={()=>setEdited(false)}><FieldGroup>
    <input type="hidden" name="mode" value={automatic?"auto":"manual"} />
    <input type="hidden" name="timezone" value={automatic?detected:manual} />
    <Field orientation="horizontal"><Checkbox id="timezone-auto" checked={automatic} disabled={pending} onCheckedChange={(checked)=>{setEdited(true);setAutomatic(checked);if(!checked && !manual)setManual(detected);}} /><FieldLabel htmlFor="timezone-auto">Use device timezone automatically</FieldLabel></Field>
    <FieldDescription>{detected?`Your device timezone: ${detected}.`:"Detecting your device timezone…"} Choose a fixed timezone to keep the same calendar across devices.</FieldDescription>
    <Field><FieldLabel htmlFor="workspace-timezone">Workspace timezone</FieldLabel>
      <Combobox items={zones} value={automatic?detected||null:manual||null} disabled={automatic||pending} onValueChange={(value)=>{setEdited(true);setManual(value??"");}}>
        <ComboboxInput id="workspace-timezone" aria-label="Workspace timezone" placeholder={automatic?"Detecting local timezone…":"Search timezones…"} disabled={automatic||pending} />
        <ComboboxContent><ComboboxEmpty>No matching timezone.</ComboboxEmpty><ComboboxList>{(zone:string)=><ComboboxItem key={zone} value={zone}>{zone}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
      <FieldDescription>Calendar dates, scheduling, rescheduling and reports use this timezone. Existing delivery instants stay the same.</FieldDescription>
    </Field>
    {!edited&&<Feedback result={result} />}<Button type="submit" disabled={pending||!(automatic?detected:manual)}>{pending&&<LoaderCircle className="animate-spin" />}Save timezone</Button>
  </FieldGroup></form>;
}

function Feedback({ result }: { result: SettingsResult }) {
  return result.message ? <p role={result.error ? "alert" : "status"} className={result.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{result.message}</p> : null;
}
function Pending({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return <Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}{children}</Button>;
}

export function IntegrationForm({ section, fields }: {
  section: "google" | "composio"; fields: { name: string; label: string; configured: boolean; value?: string; secret?: boolean }[];
}) {
  const [result, action, pending] = useActionState(saveIntegrations, initial);
  const [check, setCheck] = useState(initial);
  const [checking, startCheck] = useTransition();
  return <form action={action}>
    <input type="hidden" name="section" value={section} />
    <FieldGroup>
      {fields.map((field) => <Field key={field.name}>
        <FieldLabel htmlFor={field.name}>{field.label}{field.configured && <Badge variant="secondary"><Check />Configured</Badge>}</FieldLabel>
        <Input id={field.name} name={field.name} aria-label={field.label} type={field.secret ? "password" : "text"} defaultValue={field.secret ? "" : field.value}
          autoComplete="off" spellCheck={false} maxLength={4096} disabled={pending} placeholder={field.configured ? "Leave blank to keep the saved value" : undefined} />
      </Field>)}
      {section === "google" && <Field orientation="horizontal"><Checkbox id="disable-google" name="disable" value="yes" disabled={pending} /><FieldLabel htmlFor="disable-google">Disable Google sign-in</FieldLabel></Field>}
      <Feedback result={result} /><Feedback result={check} />
      <div className="flex flex-wrap gap-2">
        <Pending pending={pending}>Save settings</Pending>
        {section === "composio" && <Button type="button" variant="outline" disabled={pending || checking} onClick={() => startCheck(async () => setCheck(await testComposioSettings()))}>{checking ? "Testing…" : "Test saved connection"}</Button>}
      </div>
    </FieldGroup>
  </form>;
}

export function PasswordSettings({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const [result, action, pending] = useActionState(setOwnerPassword, initial);
  return <form action={action}><input type="text" name="username" autoComplete="username" value={email} readOnly hidden /><FieldGroup>
    {hasPassword && <Field><FieldLabel htmlFor="current-password">Current password</FieldLabel><Input id="current-password" type="password" name="current" autoComplete="current-password" required disabled={pending} /></Field>}
    <Field><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
      <FieldDescription>{passwordRules.map(({ text }) => text).join(" · ")}</FieldDescription></Field>
    <Field><FieldLabel htmlFor="repeat-password">Confirm new password</FieldLabel><Input id="repeat-password" name="confirm" type="password" autoComplete="new-password" required disabled={pending} /></Field>
    <Feedback result={result} /><Pending pending={pending}>{hasPassword ? "Change password" : "Set password"}</Pending>
  </FieldGroup></form>;
}
export function GoogleLink() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return <div className="grid gap-2"><Button variant="outline" disabled={pending} onClick={() => start(async () => {
    try {
      const result = await createAuthClient().linkSocial({ provider: "google", callbackURL: "/dashboard/settings?google=linked", errorCallbackURL: "/dashboard/settings?google=failed" });
      if (result.error) setError("Google couldn’t be linked. Use the same email as your owner account.");
    } catch { setError("Couldn’t open Google. Check the saved client credentials."); }
  })}>Connect your Google account</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
export function WorkerSync({ worker, configured }: { worker: string; configured: boolean }) {
  const [result, setResult] = useState(initial);
  const [pending, start] = useTransition();
  return <div className="grid gap-3">
    <p className="text-sm text-muted-foreground">{configured ? "Target Worker · " + worker : "Add the Cloudflare deployment connection on the server to enable Worker sync."}</p>
    <Button variant="outline" disabled={pending || !configured} onClick={() => {
      if (window.confirm("Apply the saved integrations and provider keys to Worker " + worker + "?")) start(async () => setResult(await syncWorkerSettings()));
    }}>{pending ? "Applying…" : "Apply configuration to Worker"}</Button>
    <Feedback result={result} />
  </div>;
}
