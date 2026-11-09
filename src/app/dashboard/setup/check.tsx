"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { checkComposio } from "./actions";

export function SetupCheck() {
  const [result, action, pending] = useActionState(checkComposio, { project: "", threads: "" });
  return (
    <form action={action} className="grid gap-3">
      <Button type="submit" className="w-fit" disabled={pending}>{pending ? "Checking…" : "Check setup"}</Button>
      <div role="status" className="grid gap-1 text-sm">
        {result.project && <p>{result.project}</p>}
        {result.threads && <p>{result.threads}</p>}
      </div>
    </form>
  );
}

