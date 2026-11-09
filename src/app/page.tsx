import { Card } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileText, ImageIcon, Layers, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { buttonVariants } from "@/components/ui/button";

const sampleWeek = [
  ["Mon", "Coastal notes from the road", "Scheduled", "10:00 AM", "coast"],
  ["Tue", "In the studio", "Draft", "2:00 PM", "bloom"],
  ["Wed", "", "", ""],
  ["Thu", "Light, texture and place", "Scheduled", "11:00 AM", "arch"],
  ["Fri", "A slower creative week", "Draft", "4:00 PM", "shutters"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-[82rem] px-5 sm:px-10">
      <header className="flex min-h-20 items-center justify-between gap-4 border-b">
        <Brand />
        <Link href="#overview" className="hidden text-sm font-medium hover:underline sm:inline">Overview</Link>
        <div className="flex items-center gap-3">
          <ThemeSwitch />
          <Link href="/dashboard/calendar" className={buttonVariants()}>Open studio <ArrowRight /></Link>
        </div>
      </header>
      <section id="overview" className="relative isolate overflow-hidden py-12 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute top-52 -right-5 -z-10 hidden aspect-[4/3] w-[58%] overflow-hidden rounded-tl-[85%] sm:block">
          <Image src="/studio-poppy.webp" alt="" fill unoptimized className="object-cover" />
        </div>
        <p className="text-xs font-bold tracking-[.23em] uppercase">A social studio of your own</p>
        <h1 className="mt-5 max-w-5xl text-5xl leading-[.97] font-extrabold tracking-[-.065em] sm:text-7xl lg:text-[5rem]">
          Good ideas deserve <br className="hidden lg:block" />to be <em className="font-serif font-normal text-primary">seen.</em>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">Plan, write and publish. Your accounts, your AI, your space.</p>
        <Link href="/dashboard/calendar" className={buttonVariants({ size: "lg", className: "mt-7" })}>
          Start your studio <ArrowRight />
        </Link>
        <Card role="region" aria-label="Example studio calendar" className="gap-0 py-0  relative mt-12 grid overflow-hidden rounded-2xl border bg-card shadow-xl sm:mt-16 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <aside className="hidden border-r bg-sidebar p-4 sm:block">
            <Brand />
            <ul className="mt-5 grid gap-3 text-sm">
              {([[CalendarDays, "Calendar"], [FileText, "Drafts"], [ImageIcon, "Media"], [Layers, "Accounts"], [Sparkles, "Assistant"]] as const).map(([Icon, label]) => {

                return <li key={label} className="flex items-center gap-2"><Icon className="size-4" aria-hidden />{label}</li>;
              })}
            </ul>
          </aside>
          <div>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <h2 className="text-xl font-bold tracking-tight">Your week, in view.</h2>
              <span className="text-xs text-muted-foreground">Example calendar</span>
            </header>
            <div className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              {sampleWeek.map(([day, title, status, time, photo]) => (
                <div key={day} className="p-3 sm:min-h-40">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">{day}</p>
                  {photo && <div className="mt-2 grid grid-cols-[3.5rem_1fr] items-center gap-2 rounded-lg border bg-background p-1.5 text-sm sm:grid-cols-1 sm:items-stretch">
                    <Image src={`/studio-${photo}.webp`} width={400} height={460} alt="" unoptimized
                      className="aspect-square w-full rounded-md object-cover sm:aspect-[4/4.6]" />
                    <div className="grid gap-1 px-1 pb-1">
                      <strong className="leading-tight">{title}</strong>
                    <span className={status === "Scheduled" ? "text-xs text-primary" : "text-xs text-muted-foreground"}>{status} · {time}</span>
                    </div>
                  </div>}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>
      <footer className="flex items-center justify-between gap-4 border-t py-6">
        <Brand />
        <p className="font-serif italic">Your voice. On your terms.</p>
      </footer>
    </main>
  );
}
