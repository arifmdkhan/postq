"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { getInsights } from "./actions";

export function Insights({ id }: { id: string }) {
  const [result, action, pending] = useActionState(getInsights.bind(null, id), { metrics: [], error: "" });
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Loading…" : "Load insights"}</Button>
      <div aria-live="polite" className="text-sm">
        {result.error && <p>{result.error}</p>}
        {result.metrics.length > 0 && <dl className="flex flex-wrap gap-3">
          {result.metrics.map(({ name, value }) => <div key={name} className="flex gap-1"><dt className="capitalize">{name}</dt><dd>{value.toLocaleString()}</dd></div>)}
        </dl>}
      </div>
    </form>
  );
}

