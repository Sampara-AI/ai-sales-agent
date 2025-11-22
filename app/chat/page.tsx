"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
  timestamp: Date;
}

type ChatResponse = { content: string };

const systemPrompt = "You are an expert AI sales consultant for an enterprise AI startup. The founder has 6 patents in AI architecture and has helped 100+ enterprises implement AI solutions.\n\nYour goal: Understand the prospect's AI challenges through 3-5 natural, conversational questions. Ask ONE question at a time. Listen actively and ask intelligent follow-ups based on their responses.\n\nFlow:\n- Start with: 'Hi! I'm here to help you assess your AI readiness. What's your biggest challenge with AI right now?'\n- Ask follow-up questions about: their tech stack, team size, budget considerations, timeline, or specific use cases\n- After 3-5 exchanges, say: 'Based on what you've shared, I can generate a personalized AI readiness report for you. What's your email address?'\n- Once they provide email, say: 'Perfect! I'm generating your report now. You'll receive it at [their email] in the next minute. Would you like to book a quick call to discuss the findings?'\n\nBe consultative, not pushy. Sound like a knowledgeable peer, not a salesperson. Keep responses concise (2-3 sentences max).";

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailCaptured, setEmailCaptured] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportDownloadUrl, setReportDownloadUrl] = useState<string | null>(null);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) return createClient(url, anonKey);
    return null;
  }, []);

  const emailRegex = useMemo(() => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, []);

  const scoreConversation = (msgs: Message[]) => {
    const text = msgs.map((m) => m.content).join("\n");
    let score = 0;
    const enterpriseSignals = /(enterprise|fortune|global|scale|compliance|security|sla)/i.test(text) ? 35 : 10;
    const decisionMaker = /(vp|director|c-?suite|chief|head)/i.test(text) ? 25 : 5;
    const urgency = /(urgent|timeline|deadline|q[1-4]|this quarter|asap|now)/i.test(text) ? 20 : 5;
    const budget = /(budget|cost|roi|pricing|spend)/i.test(text) ? 20 : 5;
    score = enterpriseSignals + decisionMaker + urgency + budget;
    if (score > 100) score = 100;
    return score;
  };

  const priorityFromScore = (score: number) => (score >= 80 ? "high" : score >= 50 ? "medium" : "low");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content:
            "Hi! I'm here to help you assess your AI readiness. What's your biggest challenge with AI right now?",
          timestamp: new Date(),
        },
      ]);
    }
  }, [messages.length]);

  const sendToGroq = async (history: Message[]): Promise<string> => {
    const payload = {
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    };
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Rate limited");
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Chat error");
    }
    const data: ChatResponse = await res.json();
    return data.content;
  };

  const handleSend = async () => {
    if (!input.trim() || sending || emailCaptured) return;
    setError(null);
    const userMsg: Message = { role: "user", content: input.trim(), timestamp: new Date() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const content = await sendToGroq(next);
      const aiMsg: Message = { role: "assistant", content, timestamp: new Date() };
      const updated = [...next, aiMsg];
      setMessages(updated);

      const providedEmail = userMsg.content.match(emailRegex)?.[0] ?? null;
      if (providedEmail && !emailCaptured) {
        setEmailCaptured(providedEmail);
        const leadScore = scoreConversation(updated);
        setSuccess("Thanks! Your AI readiness report is being generated. Check your email in 1-2 minutes.");
        if (supabase) {
          try {
            const toStore = {
              prospect_email: providedEmail,
              messages: updated.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp.toISOString() })),
              lead_score: leadScore,
              status: "new",
            };
            const { data: inserted, error: insertErr } = await supabase
              .from("conversations")
              .insert(toStore)
              .select("id")
              .single();
            if (insertErr) {
              console.error("Failed to save conversation", insertErr);
            } else if (inserted?.id) {
              try {
                const genRes = await fetch("/api/generate-report", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    conversation_id: inserted.id,
                    prospect_email: providedEmail,
                    messages: updated.map((m) => ({ role: m.role, content: m.content })),
                  }),
                });
                if (!genRes.ok) {
                  const errJson = await genRes.json().catch(() => ({}));
                  console.error("Report generation failed", errJson);
                } else {
                  const genData: { success: boolean; report: string; lead_score: number; summary: string; download_url: string } = await genRes.json();
                  if (genData?.success) {
                    setReport(genData.report);
                    setReportDownloadUrl(genData.download_url);
                    const aiMsg2: Message = { role: "assistant", content: "I've generated your AI Readiness Report below.", timestamp: new Date() };
                    setMessages((prev) => [...prev, aiMsg2]);
                  }
                }
              } catch (e) {
                console.error("Report generation network error", e);
              }
            }
          } catch (err) {
            console.error("Failed to save conversation", err);
          }
        }
      }
    } catch (err: any) {
      setError(
        err?.message === "Rate limited"
          ? "I'm having trouble connecting. Please refresh and try again."
          : "I'm having trouble connecting. Please refresh and try again."
      );
    } finally {
      setSending(false);
    }
  };

  const onDownloadReport = () => {
    if (!reportDownloadUrl) return;
    const a = document.createElement("a");
    a.href = reportDownloadUrl;
    a.download = "AI_Readiness_Report.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor = sending ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="min-h-screen w-full bg-black text-zinc-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-zinc-900/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className={`h-2 w-2 rounded-full ${statusColor}`}></div>
          <h1 className="text-lg font-semibold">AI Sales Consultant</h1>
        </div>
        <div className="text-sm text-zinc-400">{sending ? "Thinking" : "Online"}</div>
      </header>

      <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div key={i} className={`mb-4 flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow ${
                  isUser ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-100"
                }`}>
                  <div>{m.content}</div>
                  <div className="mt-2 text-xs text-zinc-300" suppressHydrationWarning>
                    {new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </div>
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="mb-4 flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl bg-zinc-800 px-4 py-3 text-sm shadow">
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300 [animation-delay:0ms]"></span>
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300 [animation-delay:150ms]"></span>
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300 [animation-delay:300ms]"></span>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg border border-green-600/30 bg-green-900/30 p-3 text-green-300 text-sm">
              {success}
            </div>
          )}
          {report && (
            <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-800 p-6 shadow">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-lg font-semibold">AI Readiness Report</div>
                <button
                  onClick={onDownloadReport}
                  disabled={!reportDownloadUrl}
                  className="inline-flex items-center rounded-lg border border-white/10 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  Download Report (PDF)
                </button>
              </div>
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <h1 className="mb-3 text-2xl font-bold">{children}</h1>,
                    h2: ({ children }) => <h2 className="mt-4 mb-2 text-xl font-semibold">{children}</h2>,
                    p: ({ children }) => <p className="leading-7 text-zinc-200">{children}</p>,
                    ul: ({ children }) => <ul className="ml-5 list-disc space-y-1 text-zinc-200">{children}</ul>,
                    ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1 text-zinc-200">{children}</ol>,
                    li: ({ children }) => <li className="text-zinc-200">{children}</li>,
                    code: ({ children }) => <code className="rounded bg-zinc-700 px-1 py-0.5 text-zinc-100">{children}</code>,
                    hr: () => <hr className="my-4 border-white/10" />,
                  }}
                >
                  {report}
                </ReactMarkdown>
              </div>
              <div className="mt-6 rounded-xl border border-blue-600/20 bg-blue-900/30 p-4 text-blue-300">
                Want to discuss these findings? Book a 15-minute call
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/10 bg-zinc-900/60 p-4">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending || !!emailCaptured}
              className="flex-1 rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 text-sm text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder={emailCaptured ? "Input disabled after email captured" : "Type your message"}
            />
            <button
              onClick={handleSend}
              disabled={sending || !!emailCaptured}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}