"use client";
import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { passwordRules, strongPassword } from "@/server/password";
const client = createAuthClient();

export function EmailSignIn({ signup }: { signup: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    if (signup && !strongPassword(password)) { setError("Complete all password requirements."); return; }
    if (signup && password !== form.get("confirm")) { setError("Passwords don’t match."); return; }
    setPending(true); setError("");
    try {
      const email = String(form.get("email") ?? "").trim();
      const result = signup
        ? await client.signUp.email({ name: String(form.get("name") ?? "").trim(), email, password }, { headers: { "x-postq-bootstrap": String(form.get("bootstrap") ?? "") } })
        : await client.signIn.email({ email, password });
      if (result.error) { setError(result.error.message || "Couldn’t sign in. Check your details."); router.refresh(); }
      else { router.replace(signup ? "/dashboard/settings?welcome=1" : "/dashboard/calendar"); router.refresh(); }
    } catch { setError("Couldn’t reach PostQ. Try again."); }
    finally { setPending(false); }
  }}>
    <FieldGroup>
      {signup && <Field><FieldLabel htmlFor="owner-name">Your name</FieldLabel><Input id="owner-name" name="name" autoComplete="name" maxLength={80} required disabled={pending} /></Field>}
      {signup && <Field><FieldLabel htmlFor="bootstrap-token">Bootstrap token</FieldLabel><Input id="bootstrap-token" name="bootstrap" type="password" autoComplete="off" maxLength={256} required disabled={pending} /><FieldDescription>Use POSTQ_BOOTSTRAP_TOKEN from the server environment. It is required only for the first account.</FieldDescription></Field>}
      <Field><FieldLabel htmlFor="owner-email">Email</FieldLabel><Input id="owner-email" name="email" type="email" autoComplete="email" required disabled={pending} /></Field>
      <Field>
        <FieldLabel htmlFor="owner-password">Password</FieldLabel>
        <div className="relative">
          <Input id="owner-password" name="password" className="pr-12" type={visible ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"}
            value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} minLength={signup ? 12 : undefined} required disabled={pending} />
          <Button type="button" size="icon" variant="ghost" className="absolute top-0 right-0" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff /> : <Eye />}</Button>
        </div>
        {signup && <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="Password requirements">
          {passwordRules.map(({ text, test }) => <li key={text} className="flex items-center gap-2"><Check aria-hidden className={test(password) ? "size-3 text-primary" : "size-3 opacity-25"} /><span>{text}{test(password) ? " ✓" : ""}</span></li>)}
        </ul>}
      </Field>
      {signup && <Field><FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel><Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" maxLength={128} required disabled={pending} /></Field>}
      {error && <FieldError role="alert">{error}</FieldError>}
      <Button type="submit" disabled={pending}>{pending ? "Please wait…" : signup ? "Create owner account" : "Sign in"}</Button>
      {signup && <FieldDescription>This creates the owner account for this PostQ workspace. You can add Google sign-in in Settings afterward.</FieldDescription>}
    </FieldGroup>
  </form>;
}
