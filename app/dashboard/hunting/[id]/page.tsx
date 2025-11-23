"use client";
import { useEffect, useMemo, useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type Campaign = {
  id: string;
  name: string;
  status: "active" | "paused" | "draft";
  target_summary?: string;
  titles?: string[] | null;
  industries?: string[] | null;
  locations?: string[] | null;
  size_min?: number | null;
  size_max?: number | null;
  keywords?: string[] | null;
  exclude_companies?: string[] | null;
  found_count?: number | null;
  contacted_count?: number | null;
  replied_count?: number | null;
  booked_count?: number | null;
  last_run_at?: string | null;
  schedule_start?: string | null;
};

type Prospect = {
  id: string;
  created_at: string;
  name: string;
  title?: string | null;
  company?: string | null;
  industry?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  ai_score?: number | null;
  status: string;
  source: string;
  contacted_at?: string | null;
  last_email_sent?: string | null;
  replied?: boolean | null;
  meeting_booked?: boolean | null;
  campaign_id?: string | null;
};

type ActivityRun = {
  id: string;
  created_at: string;
  campaign_id: string;
  run_type: "hunt" | "email" | "followup";
  result_summary?: string;
  status: "success" | "partial" | "error";
};

type EmailPreview = {
  subject_lines: string[];
  body: string;
  personalization_score: number;
  confidence_score: number;
  reasoning: string;
};

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || "");

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (url && anon) return createClient(url, anon);
    return null;
  }, []);

  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [nameEdit, setNameEdit] = useState<string>("");
  const [savingName, setSavingName] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "contacted" | "replied" | "meeting">("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [emailProspect, setEmailProspect] = useState<Prospect | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);

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

  const fromNow = (iso?: string | null) => {
    if (!iso) return "—";
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "—";
    const d = Math.floor(diff / 86400000);
    if (d > 0) return `In ${d}d`;
    const h = Math.floor(diff / 3600000);
    if (h > 0) return `In ${h}h`;
    const m = Math.floor(diff / 60000);
    return `In ${m}m`;
  };

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!supabase) throw new Error("Supabase not configured");
      const cRes = await supabase.from("hunting_campaigns").select("id,name,status,target_summary,titles,industries,locations,size_min,size_max,keywords,exclude_companies,found_count,contacted_count,replied_count,booked_count,last_run_at,schedule_start").eq("id", id).single();
      if (cRes.error) throw new Error(cRes.error.message);
      setCampaign(cRes.data as Campaign);
      setNameEdit((cRes.data as Campaign).name);

      const p1 = await supabase.from("prospects").select("*").eq("campaign_id", id).order("created_at", { ascending: false }).limit(500);
      let rows: Prospect[] = [];
      if (!p1.error) rows = (p1.data || []) as Prospect[];
      if (rows.length === 0) {
        const p2 = await supabase.from("prospects").select("*").eq("source", `campaign:${id}`).order("created_at", { ascending: false }).limit(500);
        if (!p2.error) rows = (p2.data || []) as Prospect[];
      }
      if (rows.length === 0 && cRes.data?.name) {
        const p3 = await supabase.from("prospects").select("*").eq("source", cRes.data.name).order("created_at", { ascending: false }).limit(500);
        if (!p3.error) rows = (p3.data || []) as Prospect[];
      }
      setProspects(rows);

      const rRes = await supabase.from("hunting_campaign_runs").select("id,created_at,campaign_id,run_type,result_summary,status").eq("campaign_id", id).order("created_at", { ascending: false }).limit(100);
      setRuns(((rRes.data || []) as ActivityRun[]));

      const channel = supabase
        .channel(`campaign-${id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "prospects", filter: `campaign_id=eq.${id}` }, (payload) => {
          setProspects((prev) => {
            const p = payload as any;
            if (p.eventType === "DELETE") return prev.filter((x) => x.id !== p.old?.id);
            const idx = prev.findIndex((x) => x.id === p.new?.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = p.new; return next; }
            return [p.new, ...prev];
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "hunting_campaign_runs", filter: `campaign_id=eq.${id}` }, (payload) => {
          setRuns((prev) => [payload.new as any, ...prev]);
        });
      channel.subscribe();

    } catch (e: any) {
      setError(e?.message || "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [id]);

  const toggleStatus = async () => {
    if (!supabase || !campaign) return;
    try {
      setTogglingStatus(true);
      const next = campaign.status === "active" ? "paused" : "active";
      const res = await supabase.from("hunting_campaigns").update({ status: next }).eq("id", campaign.id).select("status").single();
      if (res.error) throw new Error(res.error.message);
      setCampaign({ ...campaign, status: next });
      setBanner(next === "active" ? "Campaign activated" : "Campaign paused");
    } catch (e: any) {
      setError(e?.message || "Failed to toggle status");
    } finally {
      setTogglingStatus(false);
    }
  };

  const saveName = async () => {
    if (!supabase || !campaign) return;
    try {
      setSavingName(true);
      const res = await supabase.from("hunting_campaigns").update({ name: nameEdit }).eq("id", campaign.id).select("name").single();
      if (res.error) throw new Error(res.error.message);
      setCampaign({ ...campaign, name: nameEdit });
      setBanner("Name updated");
    } catch (e: any) {
      setError(e?.message || "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  const huntNow = async () => {
    try {
      setControlBusy("hunt");
      const res = await fetch(`/api/campaigns/${id}/hunt`, { method: "POST" });
      if (!res.ok) throw new Error("Hunt failed");
      setBanner("Hunt started");
    } catch (e: any) {
      setError(e?.message || "Failed to start hunt");
    } finally {
      setControlBusy(null);
    }
  };

  const sendEmails = async () => {
    try {
      setControlBusy("send");
      const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
      if (!res.ok) throw new Error("Send failed");
      setBanner("Sending emails");
    } catch (e: any) {
      setError(e?.message || "Failed to send emails");
    } finally {
      setControlBusy(null);
    }
  };

  const runFollowups = async () => {
    try {
      setControlBusy("followup");
      const res = await fetch(`/api/campaigns/${id}/followup`, { method: "POST" });
      if (!res.ok) throw new Error("Follow-ups failed");
      setBanner("Running follow-ups");
    } catch (e: any) {
      setError(e?.message || "Failed to run follow-ups");
    } finally {
      setControlBusy(null);
    }
  };

  const exportCsv = () => {
    const header = ["id","name","title","company","industry","email","ai_score","status","source"];
    const rows = prospects.map((p) => [p.id, p.name, p.title || "", p.company || "", p.industry || "", p.email || "", String(p.ai_score || 0), p.status, p.source]);
    const csv = [header.join(","), ...rows.map((r) => r.map((v) => String(v).replace(/"/g, '""')).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${id}-prospects.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pauseCampaign = () => toggleStatus();

  const deleteCampaign = async () => {
    if (!supabase || !campaign) return;
    try {
      const res = await supabase.from("hunting_campaigns").delete().eq("id", campaign.id);
      if (res.error) throw new Error(res.error.message);
      router.push("/dashboard/hunting");
    } catch (e: any) {
      setError(e?.message || "Delete failed");
    }
  };

  const filteredProspects = prospects.filter((p) => {
    if (statusFilter === "new" && p.status !== "new") return false;
    if (statusFilter === "contacted" && p.status !== "contacted") return false;
    if (statusFilter === "replied" && !p.replied) return false;
    if (statusFilter === "meeting" && !p.meeting_booked) return false;
    return true;
  });

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((s) => ({ ...s, [id]: checked }));
  };

  const bulkGenerateEmails = async () => {
    const ids = Object.keys(selected).filter((i) => selected[i]);
    for (const pid of ids) {
      const p = prospects.find((x) => x.id === pid);
      if (!p) continue;
      try {
        const res = await fetch("/api/generate-outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name, title: p.title || undefined, company: p.company || undefined, industry: p.industry || undefined, recent_activity: "", pain_points: "", source: p.source, prospect_id: p.id }) });
        if (!res.ok) throw new Error("Generate failed");
      } catch {}
    }
    setBanner("Email drafts generated");
  };

  const bulkSendSelected = async () => {
    const ids = Object.keys(selected).filter((i) => selected[i]);
    for (const pid of ids) {
      const p = prospects.find((x) => x.id === pid);
      if (!p || !p.email) continue;
      try {
        const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: p.id, to: p.email, subject: `Quick note for ${p.name}`, body: `Hi ${p.name}, just a quick note.` }) });
        if (!res.ok) throw new Error("Send failed");
      } catch {}
    }
    setBanner("Sent selected emails");
  };

  const bulkArchive = async () => {
    if (!supabase) return;
    const ids = Object.keys(selected).filter((i) => selected[i]);
    await supabase.from("prospects").update({ status: "archived" }).in("id", ids);
    setBanner("Archived selected");
  };

  const openEmailModal = async (p: Prospect) => {
    setEmailProspect(p);
    try {
      const res = await fetch("/api/generate-outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name, title: p.title || undefined, company: p.company || undefined, industry: p.industry || undefined, recent_activity: "", pain_points: "", source: p.source, prospect_id: p.id }) });
      if (!res.ok) throw new Error("Generate failed");
      const data = await res.json();
      setEmailPreview({ subject_lines: data.subject_lines, body: data.email_body, personalization_score: data.personalization_score, confidence_score: data.confidence_score, reasoning: data.reasoning });
    } catch (e: any) {
      setError(e?.message || "Failed to generate preview");
    }
  };

  const sendNow = async () => {
    if (!emailProspect || !emailPreview) return;
    try {
      setEmailSending(true);
      const subject = emailPreview.subject_lines?.[0] || `Quick note for ${emailProspect.name}`;
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: emailProspect.id, to: emailProspect.email, subject, body: emailPreview.body }) });
      if (!res.ok) throw new Error("Send failed");
      setBanner("Email sent");
      setEmailProspect(null);
      setEmailPreview(null);
    } catch (e: any) {
      setError(e?.message || "Failed to send email");
    } finally {
      setEmailSending(false);
    }
  };

  const responseSeries = useMemo(() => {
    const byDay: Record<string, { date: string; sent: number; replies: number }> = {};
    for (const p of prospects) {
      const d = p.last_email_sent ? new Date(p.last_email_sent) : null;
      const key = d ? d.toISOString().slice(0, 10) : new Date(p.created_at).toISOString().slice(0, 10);
      if (!byDay[key]) byDay[key] = { date: key, sent: 0, replies: 0 };
      if (p.last_email_sent) byDay[key].sent += 1;
      if (p.replied) byDay[key].replies += 1;
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).slice(-14).map((x) => ({ date: x.date.slice(5), rate: x.sent ? Math.round((x.replies / x.sent) * 100) : 0 }));
  }, [prospects]);

  const segmentBars = useMemo(() => {
    const byIndustry: Record<string, { name: string; replies: number; sent: number }> = {};
    for (const p of prospects) {
      const key = p.industry || "Unknown";
      if (!byIndustry[key]) byIndustry[key] = { name: key, replies: 0, sent: 0 };
      if (p.last_email_sent) byIndustry[key].sent += 1;
      if (p.replied) byIndustry[key].replies += 1;
    }
    return Object.values(byIndustry).map((x) => ({ name: x.name, rate: x.sent ? Math.round((x.replies / x.sent) * 100) : 0 })).sort((a, b) => b.rate - a.rate).slice(0, 6);
  }, [prospects]);

  const todayDelta = useMemo(() => {
    const today = new Date().toDateString();
    const f = prospects.filter((p) => new Date(p.created_at).toDateString() === today).length;
    const c = prospects.filter((p) => p.last_email_sent && new Date(p.last_email_sent).toDateString() === today).length;
    const r = prospects.filter((p) => p.replied && p.contacted_at && new Date(p.contacted_at).toDateString() === today).length;
    const m = prospects.filter((p) => p.meeting_booked && p.contacted_at && new Date(p.contacted_at).toDateString() === today).length;
    return { f, c, r, m };
  }, [prospects]);

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        {banner && <div className="mb-4 rounded-lg border border-green-600/30 bg-green-900/30 p-3 text-green-300 text-sm">{banner}</div>}
        {error && <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">{error}</div>}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} className="min-w-[240px] rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-lg font-semibold" />
            <button onClick={saveName} disabled={savingName} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm disabled:opacity-60">Save</button>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full border px-3 py-1 text-xs ${campaign?.status === "active" ? "border-green-600/40 bg-green-700/30 text-green-300" : campaign?.status === "paused" ? "border-yellow-600/40 bg-yellow-700/30 text-yellow-300" : "border-white/20 bg-white/10 text-zinc-300"}`}>{(campaign?.status || "").toUpperCase()}</span>
            <button onClick={toggleStatus} disabled={togglingStatus} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm disabled:opacity-60">{campaign?.status === "active" ? "Pause" : "Activate"}</button>
          </div>
        </div>
        <div className="mt-1 text-xs text-zinc-400">Last run {timeAgo(campaign?.last_run_at)} • Next scheduled {fromNow(campaign?.schedule_start)}</div>

        <div className="mt-6 rounded-3xl border border-white/20 bg-gradient-to-br from-zinc-900/80 to-zinc-800/60 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 text-sm font-semibold">Manual Controls</div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={huntNow} disabled={controlBusy === "hunt"} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm disabled:opacity-60">🔍 Hunt Now</button>
            <button onClick={sendEmails} disabled={controlBusy === "send"} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm disabled:opacity-60">📧 Send Emails</button>
            <button onClick={runFollowups} disabled={controlBusy === "followup"} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm disabled:opacity-60">🔄 Run Follow-ups</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button onClick={() => router.push(`/dashboard/hunting/create?edit=${id}`)} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">⚙️ Edit Settings</button>
            <button onClick={exportCsv} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">📊 Export Data</button>
            <button onClick={pauseCampaign} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">⏸️ Pause Campaign</button>
            <button onClick={deleteCampaign} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">🗑️ Delete</button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Prospects Found</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.found_count ?? prospects.length}</div>
            <div className="mt-2 text-xs text-zinc-500">+{todayDelta.f} today</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Contacted</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.contacted_count ?? prospects.filter((p) => p.last_email_sent).length}</div>
            <div className="mt-2 text-xs text-zinc-500">+{todayDelta.c} today</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Replied</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.replied_count ?? prospects.filter((p) => p.replied).length}</div>
            <div className="mt-2 text-xs text-zinc-500">+{todayDelta.r} today</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Meetings Booked</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.booked_count ?? prospects.filter((p) => p.meeting_booked).length}</div>
            <div className="mt-2 text-xs text-zinc-500">+{todayDelta.m} today</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">Prospects</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setStatusFilter("all")} className={`rounded px-3 py-1 text-xs ${statusFilter === "all" ? "bg-blue-600 text-white" : "bg-white/10"}`}>All</button>
              <button onClick={() => setStatusFilter("new")} className={`rounded px-3 py-1 text-xs ${statusFilter === "new" ? "bg-blue-600 text-white" : "bg-white/10"}`}>New</button>
              <button onClick={() => setStatusFilter("contacted")} className={`rounded px-3 py-1 text-xs ${statusFilter === "contacted" ? "bg-blue-600 text-white" : "bg-white/10"}`}>Contacted</button>
              <button onClick={() => setStatusFilter("replied")} className={`rounded px-3 py-1 text-xs ${statusFilter === "replied" ? "bg-blue-600 text-white" : "bg-white/10"}`}>Replied</button>
              <button onClick={() => setStatusFilter("meeting")} className={`rounded px-3 py-1 text-xs ${statusFilter === "meeting" ? "bg-blue-600 text-white" : "bg-white/10"}`}>Meeting Booked</button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={bulkGenerateEmails} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Generate Emails</button>
              <button onClick={bulkSendSelected} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Send Selected</button>
              <button onClick={bulkArchive} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Archive</button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-300">
                  <th className="p-2 text-left"><input type="checkbox" onChange={(e) => { const checked = e.currentTarget.checked; const next: Record<string, boolean> = {}; for (const p of filteredProspects) next[p.id] = checked; setSelected(next); }} /></th>
                  <th className="p-2 text-left">Prospect</th>
                  <th className="p-2 text-left">Company</th>
                  <th className="p-2 text-left">Title</th>
                  <th className="p-2 text-left">Score</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProspects.map((p) => {
                  const scoreClass = p.ai_score == null ? "bg-zinc-700/40 text-zinc-300" : p.ai_score > 70 ? "bg-green-700/40 text-green-300" : p.ai_score >= 40 ? "bg-yellow-700/40 text-yellow-300" : "bg-zinc-700/40 text-zinc-300";
                  return (
                    <tr key={p.id} className="border-t border-white/10">
                      <td className="p-2"><input type="checkbox" checked={!!selected[p.id]} onChange={(e) => toggleSelected(p.id, e.currentTarget.checked)} /></td>
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{p.company || "—"}</td>
                      <td className="p-2">{p.title || "—"}</td>
                      <td className="p-2"><span className={`rounded px-2 py-1 text-xs ${scoreClass}`}>{p.ai_score ?? 0}</span></td>
                      <td className="p-2">{p.status}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEmailModal(p)} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Preview Email</button>
                          {emailProspect?.id === p.id && emailPreview && (
                            <button onClick={sendNow} disabled={emailSending} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-60">Send</button>
                          )}
                          <button onClick={async () => { if (!supabase) return; await supabase.from("prospects").update({ status: "archived" }).eq("id", p.id); setBanner("Archived"); }} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700">Archive</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
            <div className="mb-3 text-sm font-semibold">Activity Timeline</div>
            <div className="space-y-3">
              {runs.length === 0 ? (
                <div className="rounded border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">No activity yet</div>
              ) : (
                runs.map((r) => (
                  <div key={r.id} className="flex items-start gap-3">
                    <div className={`mt-1 h-2 w-2 rounded-full ${r.run_type === "hunt" ? "bg-blue-500" : r.run_type === "email" ? "bg-purple-500" : "bg-amber-500"}`}></div>
                    <div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-xs text-zinc-400">{new Date(r.created_at).toLocaleTimeString()}</div>
                      <div className="text-sm">{r.run_type === "hunt" ? "Found prospects" : r.run_type === "email" ? "Sent emails" : "Ran follow-ups"}{r.result_summary ? ` • ${r.result_summary}` : ""}</div>
                      <div className="mt-1 text-xs"><span className={`rounded-full border px-2 py-0.5 ${r.status === "success" ? "border-green-600/40 bg-green-700/30 text-green-300" : r.status === "partial" ? "border-yellow-600/40 bg-yellow-700/30 text-yellow-300" : "border-red-600/40 bg-red-700/30 text-red-300"}`}>{r.status.toUpperCase()}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
            <div className="mb-3 text-sm font-semibold">Targeting Criteria</div>
            <div className="text-sm text-zinc-300">{campaign?.target_summary || "—"}</div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Titles: {(campaign?.titles || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Industries: {(campaign?.industries || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Locations: {(campaign?.locations || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Company Size: {campaign?.size_min ?? ""} - {campaign?.size_max ?? ""}</div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Keywords: {(campaign?.keywords || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">Exclude: {(campaign?.exclude_companies || [])?.join(", ") || "—"}</div>
            </div>
            <div className="mt-3"><button onClick={() => router.push(`/dashboard/hunting/create?edit=${id}`)} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Quick Edit</button></div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
          <div className="mb-4 text-sm font-semibold">Performance Metrics</div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={responseSeries}>
                  <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rate" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={segmentBars}>
                  <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="rate" fill="#a78bfa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}