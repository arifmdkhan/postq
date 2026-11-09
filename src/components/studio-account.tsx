"use client";

import Link from "next/link";
import { createAuthClient } from "better-auth/react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

const auth = createAuthClient();

export function StudioAccount({ name, email, image }: { name: string; email: string; image?: string | null }) {
  const { isMobile } = useSidebar();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "P";

  async function signOut() {
    setPending(true);
    setError(false);
    try {
      const result = await auth.signOut();
      if (result.error) throw new Error("Sign-out failed");
      // A full navigation clears the client router cache for this signed-out session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton className="min-h-11 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:justify-center" />}>
            <Avatar size="sm" aria-hidden>
              {image && <AvatarImage src={image} alt="" />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate group-data-[collapsible=icon]:sr-only">My account</span>
            <ChevronDown aria-hidden className="group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="min-w-48">
            <DropdownMenuGroup><DropdownMenuLabel><span className="block">{name}</span><span className="block font-normal text-muted-foreground">{email}</span></DropdownMenuLabel></DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/dashboard/settings" />}><Settings /> Settings</DropdownMenuItem>
            <DropdownMenuItem disabled={pending} closeOnClick={false} onClick={signOut}><LogOut /> {pending ? "Signing out…" : "Sign out"}</DropdownMenuItem>
            {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">Could not sign out. Try again.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
