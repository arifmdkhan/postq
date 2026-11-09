import { Card } from "@/components/ui/card";
import { Suspense } from "react";
import { StudioAccount } from "@/components/studio-account";
import { requireUser } from "@/server/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ComposeEntry } from "@/features/composer/entry";
import { Layers, Search, Zap } from "lucide-react";
import { Brand } from "@/components/brand";
import { Input } from "@/components/ui/input";
import { LocalTimezone } from "@/features/settings/local-timezone";
import { workspaceTimezonePreferences } from "@/features/settings/timezone";
import { StudioLoading } from "@/components/screen-loading";
import { StudioLocation, StudioNavigation } from "@/components/studio-navigation";
import { ThemeSwitch } from "@/components/theme-switch";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function StudioLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <SidebarProvider className="studio">
      <a href="#studio-content" className="sr-only z-50 rounded-md bg-background p-3 text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-7 px-4 py-5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <Brand />
          <Card className="gap-0 py-0 flex-row flex items-center gap-3 rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
            <Layers size={18} aria-hidden />
            <div><p className="text-sm font-semibold">My studio</p><p className="text-xs text-muted-foreground">Personal workspace</p></div>
          </Card>
        </SidebarHeader>
        <SidebarContent><StudioNavigation /></SidebarContent>
        <SidebarFooter className="border-t">
          <Suspense fallback={null}><AccountFooter /></Suspense>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <StudioLocation />
          </div>
          <div className="flex items-center gap-2">
            <form action="/dashboard" className="relative hidden lg:block" role="search">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search drafts" type="search" name="q" maxLength={120} placeholder="Search drafts…" className="w-44 pl-9 xl:w-52" />
            </form>
            <ThemeSwitch />
            <div className="hidden lg:block"><Link href="/dashboard/assistant" className={buttonVariants({ variant: "outline" })}><Zap /> Write with AI</Link></div>
            <Suspense fallback={null}><ComposeEntry /></Suspense>
          </div>
        </header>
        <div id="studio-content" tabIndex={-1} className="min-w-0 outline-none"><Suspense fallback={<StudioLoading />}><WorkspaceClock>{children}</WorkspaceClock></Suspense></div>
      </SidebarInset>
    </SidebarProvider>
  );
}

async function WorkspaceClock({children}:{children:React.ReactNode}) {
  await requireUser();
  return <LocalTimezone {...await workspaceTimezonePreferences()}>{children}</LocalTimezone>;
}

async function AccountFooter() {
  const { name, email, image } = await requireUser();
  return <StudioAccount name={name} email={email} image={image} />;
}
