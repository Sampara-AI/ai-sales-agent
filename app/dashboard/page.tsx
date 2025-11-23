"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { createClient } from "@supabase/supabase-js";

type Prospect = {
  id: string;
  created_at: string;
  name: string;
  title?: string | null;
  company?: string | null;
  company_size?: string | null;
  industry?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  ai_score?: number | null;
  fit_reasoning?: string | null;
  status: string;
  source: string;
  contacted_at?: string | null;
  last_email_sent?: string | null;
  replied?: boolean | null;
  meeting_booked?: boolean | null;
};

type Metrics = {
  totalProspects: number;
  emailsSent: number;
  replies: number;
  meetings: number;
  plusThisWeek: number;
  plusTodayEmails: number;
  replyRate: number;
  bookedThisWeek: number;
};

type EmailPreview = {
  subject_lines: string[];
  body: string;
  personalization_score: number;
  confidence_score: number;
  reasoning: string;
};

export default function DashboardPage() {
  const { user, profile, signOut } = useAuth();
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) return createClient(url, anonKey);
    return null;
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ totalProspects: 0, emailsSent: 0, replies: 0, meetings: 0, plusThisWeek: 0, plusTodayEmails: 0, replyRate: 0, bookedThisWeek: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({});
  const [highPriority, setHighPriority] = useState(false);
  const [needsFollowup, setNeedsFollowup] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<keyof Prospect | "ai_score" | "created_at">("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailProspect, setEmailProspect] = useState<Prospect | null>(null);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [chosenSubject, setChosenSubject] = useState<string>("");
  const [emailSending, setEmailSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [activeCampaigns, setActiveCampaigns] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase.from("prospects").select("*").order("created_at", { ascending: false }).limit(500);
        if (error) throw new Error(error.message);
        const rows = (data || []) as Prospect[];
        setProspects(rows);
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        const totalProspects = rows.length;
        const emailsSent = rows.filter((p) => !!p.last_email_sent).length;
        const replies = rows.filter((p) => p.replied).length;
        const meetings = rows.filter((p) => p.meeting_booked).length;
        const plusThisWeek = rows.filter((p) => new Date(p.created_at) >= startOfWeek).length;
        const plusTodayEmails = rows.filter((p) => p.last_email_sent && new Date(p.last_email_sent) > new Date(now.toDateString())).length;
        const replyRate = emailsSent ? Math.round((replies / emailsSent) * 100) : 0;
        const bookedThisWeek = rows.filter((p) => p.meeting_booked && p.contacted_at && new Date(p.contacted_at) >= startOfWeek).length;
        setMetrics({ totalProspects, emailsSent, replies, meetings, plusThisWeek, plusTodayEmails, replyRate, bookedThisWeek });
        const act = await supabase.from("hunting_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
        setActiveCampaigns(act.count || 0);
        const channel = supabase.channel("prospects-updates").on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, (payload) => {
          setProspects((prev) => {
            const idx = prev.findIndex((x) => x.id === (payload.new as any)?.id);
            if (payload.eventType === "DELETE") return prev.filter((x) => x.id !== (payload.old as any)?.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = payload.new as any;
              return next;
            }
            return [payload.new as any, ...prev];
          });
        });
        channel.subscribe();
      } catch (e: any) {
        setError(e?.message || "Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [supabase]);

  const filtered = prospects.filter((p) => {
    if (search && !(`${p.name} ${p.company || ""}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (statusFilter.length && !statusFilter.includes(p.status)) return false;
    if (sourceFilter.length && !sourceFilter.includes(p.source)) return false;
    const score = typeof p.ai_score === "number" ? p.ai_score : 0;
    if (score < scoreRange[0] || score > scoreRange[1]) return false;
    if (highPriority && score <= 70) return false;
    if (needsFollowup) {
      const contacted = p.last_email_sent ? new Date(p.last_email_sent) : null;
      const threeDays = 1000 * 60 * 60 * 24 * 3;
      if (!contacted || (new Date().getTime() - contacted.getTime()) < threeDays || p.replied) return false;
    }
    if (dateRange.start && new Date(p.created_at) < new Date(dateRange.start)) return false;
    if (dateRange.end && new Date(p.created_at) > new Date(dateRange.end)) return false;
    return true;
  }).sort((a, b) => {
    const va = sortKey === "ai_score" ? (a.ai_score || 0) : (a[sortKey] as any) || 0;
    const vb = sortKey === "ai_score" ? (b.ai_score || 0) : (b[sortKey] as any) || 0;
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageItems = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleAll = (checked: boolean) => {
    const ids = pageItems.map((p) => p.id);
    const next: Record<string, boolean> = { ...selected };
    for (const id of ids) next[id] = checked;
    setSelected(next);
  };

  const bulkGenerateEmails = async () => {
    const picked = prospects.filter((p) => selected[p.id]);
    for (const p of picked) {
      try {
        const res = await fetch("/api/generate-outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name, title: p.title || undefined, company: p.company || undefined, industry: p.industry || undefined, recent_activity: "", pain_points: "", source: p.source, prospect_id: p.id }),
        });
        if (!res.ok) throw new Error("Generate failed");
      } catch {}
    }
    setBanner("Email drafts generated");
  };

  const bulkMarkContacted = async () => {
    if (!supabase) return;
    const ids = Object.keys(selected).filter((id) => selected[id]);
    await supabase.from("prospects").update({ status: "contacted", last_email_sent: new Date().toISOString() }).in("id", ids);
    setBanner("Marked as contacted");
  };

  const bulkDelete = async () => {
    if (!supabase) return;
    const ids = Object.keys(selected).filter((id) => selected[id]);
    await supabase.from("prospects").delete().in("id", ids);
    setBanner("Deleted selected prospects");
  };

  const openEmailModal = async (p: Prospect) => {
    setEmailProspect(p);
    setShowEmailModal(true);
    try {
      const res = await fetch("/api/generate-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, title: p.title || undefined, company: p.company || undefined, industry: p.industry || undefined, recent_activity: "", pain_points: "", source: p.source, prospect_id: p.id }),
      });
      if (!res.ok) throw new Error("Generate failed");
      const data = await res.json();
      const preview: EmailPreview = { subject_lines: data.subject_lines, body: data.email_body, personalization_score: data.personalization_score, confidence_score: data.confidence_score, reasoning: data.reasoning };
      setEmailPreview(preview);
      setChosenSubject(preview.subject_lines?.[0] || "");
    } catch (e: any) {
      setError("Failed to generate preview");
    }
  };

  const sendNow = async () => {
    if (!emailProspect || !emailPreview || !chosenSubject) return;
    try {
      setEmailSending(true);
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect_id: emailProspect.id, to: emailProspect.email, subject: chosenSubject, body: emailPreview.body }),
      });
      if (!res.ok) throw new Error("Send failed");
      setBanner("Email sent");
      setShowEmailModal(false);
    } catch (e: any) {
      setError("Failed to send email");
    } finally {
      setEmailSending(false);
    }
  };

  const scoreColor = (n?: number | null) => (n == null ? "bg-zinc-700 text-zinc-200" : n > 70 ? "bg-green-700/40 text-green-300" : n >= 40 ? "bg-yellow-700/40 text-yellow-300" : "bg-zinc-700/40 text-zinc-300");
  const timeAgo = (iso?: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400000);
    if (d > 0) return `${d}d ago`;
    const h = Math.floor(diff / 3600000);
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(diff / 60000);
    return `${m}m ago`;
  };

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between pb-3">
          <div className="text-sm text-zinc-300">Welcome{profile?.full_name ? `, ${profile.full_name}` : user?.email ? `, ${user.email}` : ""}</div>
          <button onClick={signOut} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs">Sign Out</button>
        </div>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-zinc-800 p-4">
            <div className="text-sm text-zinc-400">Total Prospects</div>
            <div className="mt-1 text-2xl font-semibold">{metrics.totalProspects}</div>
            <div className="mt-2 text-xs text-zinc-500">+{metrics.plusThisWeek} this week</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-800 p-4">
            <div className="text-sm text-zinc-400">Emails Sent</div>
            <div className="mt-1 text-2xl font-semibold">{metrics.emailsSent}</div>
            <div className="mt-2 text-xs text-zinc-500">+{metrics.plusTodayEmails} today</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-800 p-4">
            <div className="text-sm text-zinc-400">Replies</div>
            <div className="mt-1 text-2xl font-semibold">{metrics.replies}</div>
            <div className="mt-2 text-xs text-zinc-500">{metrics.replyRate}% rate</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-800 p-4">
            <div className="text-sm text-zinc-400">Meetings</div>
            <div className="mt-1 text-2xl font-semibold">{metrics.meetings}</div>
            <div className="mt-2 text-xs text-zinc-500">+{metrics.bookedThisWeek} booked</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/dashboard/hunting" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <span>🎯 Hunting Campaigns</span>
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">{activeCampaigns}</span>
          </Link>
          <Link href="/dashboard/hunting/create" className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">+ New Campaign</Link>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <div className="text-lg font-semibold">🎯 Hunting Campaigns</div>
          <div className="mt-1 text-sm text-zinc-300">{activeCampaigns} active campaigns | {prospects.filter((p) => new Date(p.created_at).toDateString() === new Date().toDateString()).length} prospects found today</div>
          <div className="mt-4">
            <Link href="/dashboard/hunting" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>Manage Campaigns</span>
              <span>→</span>
            </Link>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <a href="/prospects/add" className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500">+ Add Prospect</a>
          <a href="/prospects/discover" className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">🔍 Discover Prospects</a>
          <button onClick={bulkGenerateEmails} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">📧 Bulk Email</button>
          <button onClick={() => setBanner("Exported CSV")} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">📊 Export CSV</button>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">↻ Refresh</button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name/company" className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm" />
          <select multiple value={statusFilter} onChange={(e) => setStatusFilter(Array.from(e.target.selectedOptions).map((o) => o.value))} className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm">
            {['discovered','researched','email_drafted','contacted','replied','meeting_booked','closed_lost'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select multiple value={sourceFilter} onChange={(e) => setSourceFilter(Array.from(e.target.selectedOptions).map((o) => o.value))} className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm">
            {['manual','apollo','github','hunter','funded_companies'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <span>Score</span>
            <input type="number" value={scoreRange[0]} onChange={(e) => setScoreRange([Number(e.target.value), scoreRange[1]])} className="w-16 rounded bg-zinc-800 p-1" />
            <span>-</span>
            <input type="number" value={scoreRange[1]} onChange={(e) => setScoreRange([scoreRange[0], Number(e.target.value)])} className="w-16 rounded bg-zinc-800 p-1" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={dateRange.start || ""} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="rounded bg-zinc-800 p-1" />
            <input type="date" value={dateRange.end || ""} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="rounded bg-zinc-800 p-1" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={highPriority} onChange={(e) => setHighPriority(e.target.checked)} /> High Priority</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needsFollowup} onChange={(e) => setNeedsFollowup(e.target.checked)} /> Needs Follow-up</label>
          <button onClick={() => { setStatusFilter([]); setSourceFilter([]); setScoreRange([0,100]); setDateRange({}); setHighPriority(false); setNeedsFollowup(false); setSearch(""); }} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Reset Filters</button>
        </div>

        {banner && <div className="mb-4 rounded-lg border border-green-600/30 bg-green-900/30 p-3 text-green-300 text-sm">{banner}</div>}
        {error && <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">{error}</div>}
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">Loading...</div>
        ) : prospects.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-10 text-center">
            <div className="text-lg">No prospects yet!</div>
            <a href="/prospects/discover" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-white">+ Discover Prospects</a>
            <div className="mt-2 text-sm text-zinc-400">Start by importing from Apollo or adding manually</div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-300">
                  <th className="px-3 py-2"><input type="checkbox" onChange={(e) => toggleAll(e.target.checked)} /></th>
                  <th className="px-3 py-2"><button onClick={() => { setSortKey("name"); setSortAsc(!sortAsc); }}>Name</button></th>
                  <th className="px-3 py-2">Title @ Company</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2"><button onClick={() => { setSortKey("ai_score"); setSortAsc(!sortAsc); }}>AI Score</button></th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last Activity</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="px-3 py-2"><input type="checkbox" checked={!!selected[p.id]} onChange={(e) => setSelected({ ...selected, [p.id]: e.target.checked })} /></td>
                    <td className="px-3 py-2">
                      <button onClick={() => setBanner(`Viewing ${p.name}`)} className="text-blue-300 hover:underline">{p.name}</button>
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{p.title || "—"} @ <a href={p.company ? `https://${(p.company || '').toLowerCase().replace(/\s+/g,'')}.com` : '#'} target="_blank" className="text-blue-300 hover:underline">{p.company || "—"}</a></td>
                    <td className="px-3 py-2"><span className="rounded-full border border-white/10 px-2 py-1 text-xs capitalize">{p.source}</span></td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs ${scoreColor(p.ai_score)}`}>{p.ai_score ?? "—"}</span></td>
                    <td className="px-3 py-2">
                      <select value={p.status} onChange={async (e) => { if (!supabase) return; await supabase.from("prospects").update({ status: e.target.value }).eq("id", p.id); }} className="rounded bg-zinc-800 p-1 text-xs">
                        {['discovered','researched','email_drafted','contacted','replied','meeting_booked','closed_lost'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{timeAgo(p.last_email_sent || p.contacted_at || p.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => openEmailModal(p)} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">✉️ Generate Email</button>
                        <button onClick={() => setBanner(`Viewing ${p.name}`)} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">🔍 View Details</button>
                        <button onClick={async () => { if (!supabase) return; await supabase.from("prospects").update({ notes: (p as any).notes ? `${(p as any).notes}\nUpdated` : "Updated" }).eq("id", p.id); setBanner("Note added"); }} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">📝 Add Note</button>
                        <button onClick={async () => { if (!supabase) return; await supabase.from("prospects").update({ status: "closed_lost" }).eq("id", p.id); setBanner("Archived"); }} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">🗑️ Archive</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <button onClick={bulkGenerateEmails} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Generate Emails</button>
                <button onClick={bulkMarkContacted} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Mark as Contacted</button>
                <button onClick={bulkDelete} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Delete</button>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-50">Prev</button>
                <span>Page {page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-50">Next</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {showEmailModal && emailPreview && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="mb-3 text-lg font-semibold">Email Preview</div>
            <div className="mb-3">
              <div className="text-sm text-zinc-300">Subject</div>
              <div className="mt-2 space-y-2">
                {emailPreview.subject_lines.map((s, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="subject" checked={chosenSubject === s} onChange={() => setChosenSubject(s)} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mb-3">
              <div className="text-sm text-zinc-300">Body</div>
              <textarea value={emailPreview.body} onChange={(e) => setEmailPreview({ ...emailPreview, body: e.target.value })} rows={8} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border border-white/10 bg-zinc-800 p-3">Personalization: {emailPreview.personalization_score}/100</div>
              <div className="rounded-lg border border-white/10 bg-zinc-800 p-3">Confidence: {emailPreview.confidence_score}/100</div>
            </div>
            <div className="mb-4 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm text-zinc-200">{emailPreview.reasoning}</div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => openEmailModal(emailProspect!)} className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Regenerate</button>
              <button onClick={() => setShowEmailModal(false)} className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Edit Later</button>
              <button onClick={sendNow} disabled={emailSending} className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-60">Send Now</button>
              <button onClick={() => setBanner("Scheduled")} className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Schedule</button>
              <button onClick={() => setBanner("Saved draft")} className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Save Draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}