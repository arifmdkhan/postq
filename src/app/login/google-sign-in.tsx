"use client";

import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const auth = createAuthClient();

export function GoogleSignIn({ callbackFailed }: { callbackFailed: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [showCallbackError, setShowCallbackError] = useState(callbackFailed);

  async function signIn() {
    setPending(true);
    setError(false);
    setShowCallbackError(false);
    try {
      const result = await auth.signIn.social({ provider: "google", callbackURL: "/dashboard/calendar", errorCallbackURL: "/login?sign-in=failed" });
      setError(Boolean(result.error));
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" className="h-11 w-full" onClick={signIn} disabled={pending} aria-busy={pending}>{pending ? "Opening Google…" : "Continue with Google"}</Button>
      {(error || showCallbackError) && <Alert variant="destructive" role="alert">
        <AlertDescription>{error ? "Google sign-in could not start. Try again." : "Google sign-in didn’t finish. Try again with the Google account configured for this workspace."}</AlertDescription>
      </Alert>}
    </>
  );
}
