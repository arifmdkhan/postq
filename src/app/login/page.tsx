import { Card } from "@/components/ui/card";
import { Brand } from "@/components/brand";
import { BrandMark } from "@/components/brand-mark";
import { SignInLoading } from "@/components/screen-loading";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoogleSignIn } from "./google-sign-in";
import { ThemeSwitch } from "@/components/theme-switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CalendarDays } from "lucide-react";
import { auth } from "@/server/auth";
import { database } from "@/server/db";
import { workspaceOwner } from "@/server/owner";
import { runtimeConfiguration } from "@/features/settings/configuration";
import { EmailSignIn } from "./email-sign-in";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default function Login({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col px-5 py-5 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between gap-3"><Brand /><ThemeSwitch /></header>
        <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-12">
          <div className="flex flex-col gap-3">
            <BrandMark className="size-11" />
            <p className="text-xs font-semibold tracking-[.14em] text-primary uppercase">PostQ studio</p>
            <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">Your publishing studio.</p>
            <p className="max-w-sm text-muted-foreground">Open your calendar, drafts, and media library.</p>
          </div>
          <Card className="gap-0 py-0  flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
            <Suspense fallback={<SignInLoading />}><SignInOption searchParams={searchParams} /></Suspense>
          </Card>
        </section>
      </div>
      <div className="relative m-4 hidden min-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl bg-neutral-900 bg-[url('/studio-poppy.webp')] bg-cover bg-center lg:block">
        <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-10 text-white xl:p-14">
          <p className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4" aria-hidden /> Your publishing calendar</p>
          <p className="max-w-md text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">Plan your next post.</p>
          <p className="max-w-sm text-base text-white/85">Draft, preview, and schedule across your connected accounts.</p>
        </div>
      </div>
    </main>
  );
}

async function SignInOption({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  await connection();
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL } = process.env;
  if (!BETTER_AUTH_URL || !BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
    return <Alert><AlertTitle>Server setup required</AlertTitle><AlertDescription>Configure the application URL and encryption secret before opening PostQ.</AlertDescription></Alert>;
  }
  const session = await (await auth()).api.getSession({ headers: await headers() });
  const owner = await workspaceOwner(await database());
  if (session?.user.id === owner) redirect("/dashboard/calendar");
  const config = await runtimeConfiguration();
  const params = await searchParams;
  return <>
    <div className="grid gap-1">
      <h1 className="text-xl font-semibold">{owner ? "Welcome back" : "Set up your studio"}</h1>
      <p className="text-sm text-muted-foreground">{owner ? "Sign in with your owner account." : "Create your owner account to get started."}</p>
    </div>
    <EmailSignIn signup={!owner} />
    {owner && config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && <>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      <GoogleSignIn callbackFailed={Boolean(params.error || params["sign-in"] === "failed")} />
    </>}
  </>;
}
