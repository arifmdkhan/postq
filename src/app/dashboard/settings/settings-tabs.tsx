"use client";

import { useState, type ReactNode } from "react";
import { Bot, Cloud, Plug, ShieldCheck } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsTabs({ initialTab, children }: { initialTab: string; children: ReactNode }) {
  const [tab, setTab] = useState(initialTab);
  return <Tabs value={tab} onValueChange={(value) => {
    const next = String(value);
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }} className="min-w-0 gap-6">
    <TabsList aria-label="Settings" className="grid h-auto w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto lg:inline-flex lg:w-fit">
      <TabsTrigger value="security" className="min-h-11 px-4"><ShieldCheck />Login & security</TabsTrigger>
      <TabsTrigger value="models" className="min-h-11 px-4"><Bot />AI models</TabsTrigger>
      <TabsTrigger value="integrations" className="min-h-11 px-4"><Plug />Integrations</TabsTrigger>
      <TabsTrigger value="deployment" className="min-h-11 px-4"><Cloud />Deployment</TabsTrigger>
    </TabsList>
    {children}
  </Tabs>;
}
