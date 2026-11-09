"use client";
import { Button } from "@/components/ui/button";

export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="grid gap-4 p-7"><h1 className="text-2xl font-semibold">This view could not load</h1>
    <p>Check connectivity and server configuration, then try again. Avoid resubmitting a delivery until you check its status.</p>
    <Button onClick={reset} className="w-fit">Try loading again</Button></section>;
}
