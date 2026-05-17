"use client";
import { useEffect, useMemo, useState } from "react";

type ThreadRow = {
  id: string;
  mailbox: string;
  external_id: string;
  subject?: string | null;
  prospect_id?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
};

type MessageRow = {
  id: string;
  created_at: string;
  mailbox: string;
  thread_external_id: string;
  direction: "inbound" | "outbound";
  from_email?: string | null;
  to_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  intent?: string | null;
  escalated?: boolean | null;
  ai_confidence?: number | null;
  ai_summary?: string | null;
  ai_next_action?: string | null;
  ai_draft_subject?: string | null;
  ai_draft_body?: string | null;
  processed_at?: string | null;
};

export default function InboxPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedThread, setSelectedThread] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [compose, setCompose] = useState({
    mailbox: "default",
    external_thread_id: "",
    from_email: "",
    to_email: "",
    subject: "",
    body: "",
  });

  const load = async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch("/api/inbox/threads");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load inbox");
      setThreads((json?.threads || []) as ThreadRow[]);
      setMessages((json?.messages || []) as MessageRow[]);
      if (!selectedThread && (json?.threads || []).length > 0) setSelectedThread(String(json.threads[0].external_id || ""));
    } catch (e: any) {
      setError(e?.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const threadMessages = messages.filter((m) => m.thread_external_id === selectedThread).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latestInbound = [...threadMessages].reverse().find((m) => m.direction === "inbound") || null;
  const signal = useMemo(() => {
    const intent = String(latestInbound?.intent || "").trim().toLowerCase();
    const esc = Boolean(latestInbound?.escalated);
    const conf = typeof latestInbound?.ai_confidence === "number" ? latestInbound.ai_confidence : null;
    if (intent === "unsubscribe") return { label: "COLD", cls: "border-slate-200 bg-slate-50 text-slate-700" };
    if (esc) return { label: "HOT", cls: "border-rose-200 bg-rose-50 text-rose-900" };
    if (["pricing_inquiry", "meeting_intent", "implementation_inquiry", "technical_evaluation"].includes(intent)) return { label: "HOT", cls: "border-rose-200 bg-rose-50 text-rose-900" };
    if (intent === "objection") return { label: "WARM", cls: "border-amber-200 bg-amber-50 text-amber-900" };
    if (intent === "curiosity") return { label: conf != null && conf >= 70 ? "WARM" : "NEUTRAL", cls: conf != null && conf >= 70 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700" };
    return { label: "NEUTRAL", cls: "border-slate-200 bg-slate-50 text-slate-700" };
  }, [latestInbound]);

  const onRespond = async () => {
    try {
      setBanner(null);
      setError(null);
      const payload = {
        mailbox: compose.mailbox,
        external_thread_id: compose.external_thread_id || undefined,
        from_email: compose.from_email,
        to_email: compose.to_email,
        subject: compose.subject,
        body: compose.body,
      };
      const res = await fetch("/api/inbox/respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to generate response");
      setBanner(json?.escalate ? "Escalation flagged (high-value signal)" : "Draft response generated");
      await load();
      setSelectedThread(String(json?.thread?.external_id || selectedThread));
    } catch (e: any) {
      setError(e?.message || "Failed to generate response");
    }
  };

  const esc = latestInbound?.escalated;

  return (
    <div className="min-h-[calc(100vh-140px)] rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold text-slate-900">Inbox</div>
          <div className="mt-1 text-sm text-slate-500">Grounded, product-aware reply handling: intent classification, draft response, escalation signals.</div>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
      </div>

      {banner && <div className={`mt-4 rounded-lg border p-3 text-sm ${esc ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`}>{banner}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800">Threads</div>
          <div className="mt-3 space-y-2">
            {threads.length === 0 ? (
              <div className="text-sm text-slate-600">No threads yet.</div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.external_id}
                  onClick={() => setSelectedThread(t.external_id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${selectedThread === t.external_id ? "border-slate-300 bg-white" : "border-slate-200 bg-white/60 hover:bg-white"}`}
                >
                  <div className="truncate font-medium text-slate-900">{t.subject || t.external_id}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{t.mailbox} • {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : "—"}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-800">Inbound → Draft Response</div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-700">Mailbox</div>
                <input value={compose.mailbox} onChange={(e) => setCompose((c) => ({ ...c, mailbox: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="default" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700">Thread ID (optional)</div>
                <input value={compose.external_thread_id} onChange={(e) => setCompose((c) => ({ ...c, external_thread_id: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="leave blank to auto-create" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700">From (prospect)</div>
                <input value={compose.from_email} onChange={(e) => setCompose((c) => ({ ...c, from_email: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="prospect@company.com" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700">To (your mailbox)</div>
                <input value={compose.to_email} onChange={(e) => setCompose((c) => ({ ...c, to_email: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="sbm@yourdomain.com" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs font-medium text-slate-700">Subject</div>
              <input value={compose.subject} onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Re: ..." />
            </div>
            <div className="mt-3">
              <div className="text-xs font-medium text-slate-700">Inbound body</div>
              <textarea value={compose.body} onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))} rows={6} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Paste inbound email here" />
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button onClick={onRespond} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Generate Draft</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">Thread Details</div>
              {latestInbound?.intent && (
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs ${signal.cls}`}>{signal.label}</span>
                  <span className={`rounded-full border px-3 py-1 text-xs ${latestInbound.escalated ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                    {latestInbound.intent}{latestInbound.ai_confidence != null ? ` • ${latestInbound.ai_confidence}/100` : ""}
                  </span>
                </div>
              )}
            </div>
            {threadMessages.length === 0 ? (
              <div className="mt-3 text-sm text-slate-600">Select a thread to view messages.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {threadMessages.map((m) => (
                  <div key={m.id} className={`rounded-xl border p-3 ${m.direction === "inbound" ? "border-slate-200 bg-slate-50" : "border-blue-200 bg-blue-50"}`}>
                    <div className="text-xs text-slate-500">{m.direction.toUpperCase()} • {new Date(m.created_at).toLocaleString()}</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">{m.subject || "—"}</div>
                    <div className="mt-2 text-sm text-slate-700">{m.snippet || "—"}</div>
                    {m.direction === "inbound" && m.ai_draft_body && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-700">Draft response</div>
                        <div className="mt-2 text-sm text-slate-800">{m.ai_draft_body}</div>
                        {(m.ai_summary || m.ai_next_action) && (
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{m.ai_summary || "—"}</div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{m.ai_next_action || "—"}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
