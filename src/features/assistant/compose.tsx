"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { Streamdown } from "streamdown";
import { ArrowDown, ArrowUp, Check, Copy, History, Lightbulb, LoaderCircle, MessageSquarePlus, Pencil, RefreshCw, Square, Target, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { Field } from "@/components/ui/field";
import { FieldSelect } from "@/components/field-select";
import { LibraryPicker } from "@/components/library-picker";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { messageText, type ChatMessage, type PostProposal } from "./chat-types";
import { ProposalCard } from "./proposal-card";

type Props = {
  id: string; initialMessages: ChatMessage[]; savedState?: string; savedError?: string | null;
  models: { id: string; label: string }[]; chats: { id: string; title: string; updated_at: number }[];
  history: { id: string; brief: string; caption: string; created_at: number }[];
  drafts: { id: string; title: string }[]; revision?: string;
  initialContext?: { id: string; brief: string } | null;
};

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="flex items-center gap-2"><Button variant="ghost" size="sm" aria-label="Copy reply" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setFailed(false); } catch { setFailed(true); }
  }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>{failed && <span role="status" className="text-xs text-muted-foreground">Select the reply to copy it.</span>}</div>;
}

export function Compose({ id, initialMessages, models, chats, history, drafts, revision, savedState, savedError, initialContext }: Props) {
  const router = useRouter();
  const [navigating, navigate] = useTransition();
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<{ id: string; brief: string } | null>(initialContext ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stopped, setStopped] = useState(savedState === "stopped");
  const [localError, setLocalError] = useState("");
  const [follow, setFollow] = useState(true);
  const transcript = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const transport = useMemo(() => new DefaultChatTransport<ChatMessage>({ api: "/api/chat",
    prepareSendMessagesRequest: ({ messages, trigger, body }) => {
      const index = messages.findLastIndex((message) => message.role === "user");
      return { body: { ...body, id, trigger, message: messages[index], parentId: messages[index - 1]?.id ?? null } };
    },
  }), [id]);
  const { messages, sendMessage, status, error, clearError, regenerate, stop } = useChat<ChatMessage>({
    id, messages: initialMessages, transport, throttle: 40,
    onFinish: () => { sending.current = false; router.refresh(); },
    onError: () => { sending.current = false; },
  });
  const busy = status === "submitted" || status === "streaming";
  const currentError = error?.message || localError || (messages.length === initialMessages.length && savedState === "error" ? savedError : "");
  const interrupted = !busy && (stopped || savedState === "streaming");
  const body = () => ({ model, draft, context: context?.id ?? "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  useLayoutEffect(()=>{
    // Keep unsent text mounted when background timezone detection refreshes the route.
    const url=new URL(window.location.href);
    if(!url.searchParams.has("chat")){url.searchParams.set("chat",id);window.history.replaceState(null,"",url);}
  },[id]);
  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight,160)}px`;
  }, [input]);
  useLayoutEffect(() => {
    if (follow && transcript.current && (messages.length || busy)) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, status, follow, busy]);
  const submit = () => {
    const text = input.trim();
    if (!text || !model || busy || navigating || sending.current) return;
    sending.current = true;
    setInput(""); setStopped(false); setLocalError(""); clearError(); setFollow(true);
    const url = new URL(window.location.href); url.searchParams.set("chat", id); window.history.replaceState(null, "", url);
    void sendMessage({ text }, { body: body() }).catch(() => { sending.current = false; });
    textarea.current?.focus();
  };
  return <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3">
    <div data-chat-heading className="flex shrink-0 items-center justify-between gap-2 border-b pb-2">
      <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Assistant</h1>
      <div className="ml-auto flex items-center gap-1">
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger render={<Button variant="ghost" size="sm" disabled={busy} />}><History data-icon="inline-start" />History</SheetTrigger>
          <SheetContent className="w-[min(95vw,28rem)] sm:max-w-md">
            <SheetHeader><SheetTitle>Your chats</SheetTitle><SheetDescription>Continue a conversation or refine an earlier proposal.</SheetDescription></SheetHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-6">
              <ul className="grid gap-2">{chats.map((chat) => <li key={chat.id}><Link href={"/dashboard/assistant?chat=" + chat.id} onNavigate={(event) => { event.preventDefault(); setHistoryOpen(false); navigate(() => router.push("/dashboard/assistant?chat=" + chat.id)); }} aria-current={chat.id === id ? "page" : undefined}
                className="block rounded-lg border p-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><p className="line-clamp-2 font-medium">{chat.title}</p></Link></li>)}</ul>
              {!chats.length && <p className="py-4 text-sm text-muted-foreground">Chats are saved after your first message.</p>}
              <Link href="/dashboard/assistant/history" className="my-3 block text-sm text-primary underline">Search all chats and proposals</Link>
              {history.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Earlier proposals</summary><ul className="mt-3 grid gap-3">{history.map((item) => <li key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="line-clamp-2 font-medium">{item.brief}</p><p className="my-2 line-clamp-3 text-muted-foreground">{item.caption}</p>
                <Button size="sm" variant="outline" onClick={() => { setContext(item); setDraft(""); setHistoryOpen(false); textarea.current?.focus(); }}>Refine proposal</Button>
              </li>)}</ul></details>}
            </div>
          </SheetContent>
        </Sheet>
        <Button variant="ghost" size="sm" disabled={busy || navigating} onClick={() => navigate(() => router.push("/dashboard/assistant?chat=" + crypto.randomUUID()))}><MessageSquarePlus data-icon="inline-start" />{navigating ? "Opening chat…" : "New chat"}</Button>
      </div>
    </div>
    <div ref={transcript} onScroll={() => { const node = transcript.current; if (node) setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 96); }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg px-1" role="log" aria-label="Conversation" aria-live="off" tabIndex={0}>
      {!messages.length && <div className="grid justify-items-center gap-2 py-4 text-center sm:py-6">
        <BrandMark className="size-8 sm:size-10" />
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">What’s your next great post?</h2>
        <p className="max-w-md text-sm leading-5 text-muted-foreground">Bring an idea, plan a campaign, or improve a draft. You review and approve publishing.</p>
        <div className="mt-2 grid w-full grid-cols-3 gap-2 text-left sm:gap-3">{[
          { Icon: Lightbulb, label: "Shape an idea", prompt: "Help me turn this idea into a post: " },
          { Icon: Target, label: "Plan a campaign", prompt: "Help me plan a campaign. My goal and audience are: " },
          { Icon: Pencil, label: "Refine a draft", prompt: "Help me improve a draft. Ask me which one if none is selected." },
        ].map(({ Icon, label, prompt }) => <Button key={label} variant="outline" className="h-auto flex-col items-start justify-start px-3 py-2 text-left whitespace-normal sm:flex-row sm:items-center" onClick={() => { setInput(prompt); textarea.current?.focus(); }}><Icon data-icon="inline-start" />{label}</Button>)}</div>
      </div>}
      <ol className="grid gap-7 py-3">{messages.map((message) => <li key={message.id} data-message-id={message.id} data-role={message.role} className="min-w-0">
        {message.role === "user" ? <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-primary-foreground wrap-anywhere sm:max-w-[80%]">{messageText(message)}</div>
          : <div className="grid min-w-0 gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><BrandMark className="size-6" />PostQ assistant</div>
            <div className="min-w-0 text-sm leading-7 wrap-anywhere sm:pl-8">{message.parts.map((part, index) => {
              if (part.type === "text") return <Streamdown key={index} isAnimating={busy && message.id === messages.at(-1)?.id} controls={false}>{part.text}</Streamdown>;
              if (isToolUIPart(part)) {
                if (part.state === "output-available" && "output" in part && part.output && typeof part.output === "object" && "campaign" in part.output) return <ProposalCard key={part.toolCallId} proposal={part.output as PostProposal} disabled={busy} />;
                return <p key={part.toolCallId} className="my-2 flex items-center gap-2 text-sm text-muted-foreground">{part.state === "output-error" ? "The proposal could not be prepared. Ask for another attempt." : busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden />Preparing your post proposal…</> : "Proposal preparation was interrupted."}</p>;
              }
              return null;
            })}</div>
            {!busy && messageText(message) && <div className="sm:pl-6"><CopyMessage text={messageText(message)} /></div>}
          </div>}
      </li>)}</ol>
      {revision && <Alert variant="destructive"><AlertTitle>Revision needs another look</AlertTitle><AlertDescription>{revision === "stale" ? "The draft changed after this proposal. Select it again and request a new revision." : "The proposal was incomplete. Try again."}</AlertDescription></Alert>}
      {!models.length && <Alert><AlertTitle>Add a model to start chatting</AlertTitle><AlertDescription><Link href="/dashboard/settings?tab=models" className="underline">Connect an AI provider and enable a model in Settings.</Link></AlertDescription></Alert>}
      {busy && <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />{status === "submitted" ? "Thinking…" : "Writing…"}</p>}
    {(currentError || interrupted) && <Alert variant={currentError ? "destructive" : "default"}><AlertTitle>{currentError ? "Reply interrupted" : "Generation stopped"}</AlertTitle>
      <AlertDescription><p>{currentError || "The reply may be incomplete. You can retry or send a follow-up."}</p><div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !messages.some((message) => message.role === "user")} onClick={() => { clearError(); setLocalError(""); setStopped(false); setFollow(true);
          void regenerate({ body: body() }).catch(() => setLocalError("Couldn’t retry. Reload the saved chat and try again.")); }}><RefreshCw />Retry reply</Button>
        <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>Reload saved chat</Button></div></AlertDescription>
    </Alert>}
    </div>
    {!follow && <Button variant="outline" size="sm" className="mx-auto shrink-0" onClick={() => setFollow(true)}><ArrowDown />Latest message</Button>}
    <form data-chat-composer onSubmit={(event) => { event.preventDefault(); submit(); }} className="shrink-0"><Field><InputGroup className="rounded-2xl shadow-sm">
      {context && <InputGroupAddon align="block-start" className="justify-between border-b"><span className="truncate">Refining: {context.brief}</span><Button type="button" variant="ghost" size="icon-sm" aria-label="Clear proposal context" disabled={busy} onClick={() => setContext(null)}><X /></Button></InputGroupAddon>}
      <InputGroupTextarea ref={textarea} aria-label="Message" aria-describedby="chat-help" disabled={navigating} value={input} onChange={(event) => setInput(event.target.value)} rows={2} maxLength={4000}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
        placeholder={busy ? "Write your next thought while I respond…" : "Ask PostQ to plan, write, or improve a post…"}
        className="max-h-40 min-h-20 resize-none overflow-y-auto px-4 py-4" />
      <InputGroupAddon align="block-end" className="flex-wrap gap-2 border-t px-3 py-2.5">
        <LibraryPicker kind="draft" label="Draft to revise" value={draft} disabled={busy} empty="Select draft to revise"
          initial={drafts.map(({ id, title }) => ({ id, name: title }))} onSelect={(item) => { setDraft(item.id); setContext(null); }} />
        <FieldSelect aria-label="AI model" value={model} disabled={busy || !models.length} onValueChange={setModel} className="min-w-0 flex-1 sm:max-w-80"
          options={models.length ? models.map(({ id, label }) => ({ value: id, label })) : [{ value: "", label: "No model configured" }]} />
        {busy ? <Button type="button" size="icon" className="ml-auto shrink-0 rounded-full" aria-label="Stop generating" onClick={() => { void stop(); sending.current = false; setStopped(true); }}><Square /></Button>
          : <Button type="submit" size="icon" className="ml-auto shrink-0 rounded-full" aria-label="Send message" disabled={navigating || !model || !input.trim()}><ArrowUp /></Button>}
      </InputGroupAddon>
    </InputGroup></Field></form>
    <div id="chat-help" className="flex shrink-0 flex-wrap justify-between gap-2 px-1 text-xs text-muted-foreground"><span>Enter to send · Shift + Enter for a new line</span><span>{input.length.toLocaleString()} / 4,000</span></div>
    <span role="status" className="sr-only">{navigating ? "Opening chat" : !busy && messages.at(-1)?.role === "assistant" && !currentError && !interrupted ? "Reply complete" : ""}</span>
  </div>;
}
