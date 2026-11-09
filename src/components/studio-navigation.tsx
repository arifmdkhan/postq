"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, FileText, ImageIcon, Send, Settings, Sparkles } from "lucide-react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

const sections = [
  { href: "/dashboard/calendar", name: "Calendar", Icon: CalendarDays },
  { href: "/dashboard", name: "Posts", Icon: FileText },
  { href: "/dashboard/media", name: "Media library", Icon: ImageIcon },
  { href: "/dashboard/publishing", name: "Accounts", Icon: Send },
  { href: "/dashboard/analytics", name: "Analytics", Icon: BarChart3 },
  { href: "/dashboard/assistant", name: "Assistant", Icon: Sparkles },
  { href: "/dashboard/settings", name: "Settings", Icon: Settings },
];

export function StudioNavigation() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <nav aria-label="Workspace">
        <SidebarMenu className="gap-1">
          {sections.map(({ href, name, Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                className="studio-nav min-h-11 px-3 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:min-h-8"
                tooltip={name}
                isActive={pathname === href || href !== "/dashboard" && pathname.startsWith(href + "/")}
                render={<Link href={href} aria-label={name} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpenMobile(false)} />}
              >
                <Icon aria-hidden />
                <span className="group-data-[collapsible=icon]:hidden">{name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  );
}



export function StudioLocation() {
  const pathname = usePathname();
  const section = sections.find(({ href }) => href === pathname || href !== "/dashboard" && pathname.startsWith(href + "/"));
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="hidden text-muted-foreground sm:inline">Workspace</span>
      <span aria-hidden className="hidden text-muted-foreground sm:inline">/</span>
      <strong>{pathname === "/dashboard/mcp-review" ? "Review request" : section?.name ?? "Studio"}</strong>
    </p>
  );
}
