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
  require_manual_review?: boolean | null;
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
  domain?: string | null;
  industry?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  recent_activity?: string | null;
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

type QueueCounts = { queued: number; running: number; succeeded: number; failed: number; dead: number };
type QueueJob = {
  id: string;
  created_at: string;
  updated_at: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
};

type EmailPreview = {
  subject_lines: string[];
  body: string;
  personalization_score: number;
  confidence_score: number;
  reasoning: string;
};

type DraftRow = {
  id: string;
  prospect_id: string;
  subject_lines: string[] | null;
  body: string;
  status: string;
  created_at: string;
  personalization_score?: number | null;
  confidence_score?: number | null;
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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null);
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [reviewSubject, setReviewSubject] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [showFullDraft, setShowFullDraft] = useState(false);

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

  const parseDomainIntel = (recent?: string | null) => {
    const raw = String(recent || "");
    const idx = raw.lastIndexOf("Domain intel:");
    if (idx === -1) return null;
    const block = raw.slice(idx);
    const summaryLine = block.split("\n").find((l) => l.trim().startsWith("Summary:")) || "";
    const summary = summaryLine.replace(/^Summary:\s*/i, "").trim();
    const hooksStart = block.indexOf("Hooks:");
    const hooksBlock = hooksStart >= 0 ? block.slice(hooksStart) : "";
    const hooks = hooksBlock
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter((l) => l.length > 0 && l.toLowerCase() !== "hooks:")
      .slice(0, 5);
    return { summary, hooks };
  };

  const stageForProspect = (p: Prospect) => {
    if (p.replied) return { label: "Replied", tone: "green" as const };
    if (p.meeting_booked) return { label: "Meeting booked", tone: "green" as const };
    if (p.last_email_sent || p.status === "contacted") return { label: "Sent", tone: "blue" as const };

    const jobs = queueJobs.filter((j) => String((j.payload as any)?.prospect_id || "") === p.id);
    const hasDead = jobs.some((j) => j.status === "dead");
    const hasRunning = jobs.some((j) => j.status === "running");
    const hasQueued = jobs.some((j) => j.status === "queued");
    const current = hasRunning ? jobs.find((j) => j.status === "running") : hasQueued ? jobs.find((j) => j.status === "queued") : null;
    if (hasDead) return { label: "Failed (retry)", tone: "red" as const };
    if (current?.type === "domain_enrich") return { label: hasRunning ? "Enriching" : "Queued: enrich", tone: "amber" as const };
    if (current?.type === "generate_outreach") return { label: hasRunning ? "Generating" : "Queued: draft", tone: "amber" as const };
    if (current?.type === "send_email") return { label: hasRunning ? "Sending" : "Queued: send", tone: "amber" as const };
    if (p.status === "researched") return { label: "Researched", tone: "slate" as const };
    if (p.status === "email_ready") return { label: "Draft ready", tone: "slate" as const };
    if (p.status === "discovered") return { label: "Imported", tone: "slate" as const };
    return { label: p.status || "—", tone: "slate" as const };
  };

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!supabase) throw new Error("Supabase not configured");
      const cRes = await supabase.from("hunting_campaigns").select("id,name,status,target_summary,require_manual_review,titles,industries,locations,size_min,size_max,keywords,exclude_companies,found_count,contacted_count,replied_count,booked_count,last_run_at,schedule_start").eq("id", id).single();
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

  const importCsvToCampaign = async () => {
    if (!importFile) {
      setError("Select a CSV file first");
      return;
    }
    try {
      setError(null);
      setBanner(null);
      setImporting(true);
      const fd = new FormData();
      fd.append("file", importFile);
      const res = await fetch(`/api/campaigns/${id}/import`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Import failed");
      const imported = typeof (json as any)?.imported === "number" ? (json as any).imported : 0;
      const skipped = typeof (json as any)?.skipped_duplicates === "number" ? (json as any).skipped_duplicates : 0;
      window.location.href = `/dashboard/hunting?campaign=${encodeURIComponent(id)}&import=${encodeURIComponent(String(imported))}&skipped=${encodeURIComponent(String(skipped))}&stage=enrich#stage`;
    } catch (e: any) {
      setError(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [id]);

  const loadQueue = async () => {
    try {
      setQueueError(null);
      const res = await fetch(`/api/campaigns/${id}/queue`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Queue load failed");
      setQueueCounts((json?.counts || null) as QueueCounts | null);
      setQueueJobs(((json?.jobs || []) as QueueJob[]).slice(0, 200));
    } catch (e: any) {
      setQueueError(e?.message || "Queue load failed");
    }
  };

  useEffect(() => {
    if (!id) return;
    loadQueue();
    const t = setInterval(loadQueue, 5000);
    return () => clearInterval(t);
  }, [id]);

  const loadDrafts = async () => {
    try {
      setDraftsError(null);
      const res = await fetch(`/api/campaigns/${id}/drafts`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Drafts load failed");
      setDrafts(((json?.drafts || []) as DraftRow[]).slice(0, 200));
    } catch (e: any) {
      setDraftsError(e?.message || "Drafts load failed");
    }
  };

  useEffect(() => {
    if (!id) return;
    loadDrafts();
    const t = setInterval(loadDrafts, 7000);
    return () => clearInterval(t);
  }, [id]);

  const retryDeadJobs = async () => {
    const ids = queueJobs.filter((j) => j.status === "dead").map((j) => j.id);
    if (ids.length === 0) return;
    try {
      setQueueBusy(true);
      await fetch("/api/admin/job-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry_dead", ids }) });
      await loadQueue();
    } finally {
      setQueueBusy(false);
    }
  };

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
      setBanner("Email send queued");
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
      setBanner("Follow-ups queued");
    } catch (e: any) {
      setError(e?.message || "Failed to run follow-ups");
    } finally {
      setControlBusy(null);
    }
  };

  const exportCsv = () => {
    const header = ["id","name","title","company","domain","industry","email","ai_score","status","source"];
    const rows = prospects.map((p) => [p.id, p.name, p.title || "", p.company || "", p.domain || "", p.industry || "", p.email || "", String(p.ai_score || 0), p.status, p.source]);
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

  const toggleManualReview = async () => {
    if (!supabase || !campaign) return;
    try {
      const next = !Boolean(campaign.require_manual_review);
      const res = await supabase.from("hunting_campaigns").update({ require_manual_review: next }).eq("id", campaign.id);
      if (res.error) throw new Error(res.error.message);
      setCampaign((c) => (c ? { ...c, require_manual_review: next } : c));
      setBanner(next ? "Manual review enabled" : "AI auto-send enabled");
    } catch (e: any) {
      setError(e?.message || "Failed to update sending mode");
    }
  };

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
        const res = await fetch("/api/generate-outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: p.id, enqueue_only: true }) });
        if (!res.ok) throw new Error("Generate failed");
      } catch {}
    }
    setBanner("Draft generation queued");
  };

  const bulkEnrichDomains = async () => {
    const ids = Object.keys(selected).filter((i) => selected[i]);
    for (const pid of ids) {
      try {
        const res = await fetch(`/api/prospects/${pid}/enrich-domain`, { method: "POST" });
        if (!res.ok) throw new Error("Enrich failed");
      } catch {}
    }
    setBanner("Domain enrichment queued");
  };

  const bulkSendSelected = async () => {
    const ids = Object.keys(selected).filter((i) => selected[i]);
    for (const pid of ids) {
      const p = prospects.find((x) => x.id === pid);
      if (!p || !p.email) continue;
      try {
        const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: p.id, to_email: p.email, subject: `Quick note for ${p.name}`, body: `Hi ${p.name}, just a quick note.` }) });
        if (!res.ok) throw new Error("Send failed");
      } catch {}
    }
    setBanner("Selected emails queued");
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
      setReviewDraftId(null);
      setReviewSubject(String((data?.subject_lines || [])[0] || "").trim());
      setReviewBody(String(data?.email_body || ""));
      setShowFullDraft(false);
      setReviewOpen(true);
    } catch (e: any) {
      setError(e?.message || "Failed to generate preview");
    }
  };

  const openReviewDraft = (draft: DraftRow) => {
    const p = prospects.find((x) => x.id === draft.prospect_id) || null;
    if (p) setEmailProspect(p);
    setEmailPreview(null);
    setReviewDraftId(draft.id);
    const subject = String((draft.subject_lines || [])[0] || "").trim();
    setReviewSubject(subject);
    setReviewBody(String(draft.body || ""));
    setShowFullDraft(false);
    setReviewOpen(true);
  };

  const sendNow = async () => {
    if (!emailProspect || !emailProspect.email) return;
    try {
      setEmailSending(true);
      const subject = reviewSubject || `Quick note for ${emailProspect.name}`;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect_id: emailProspect.id, email_draft_id: reviewDraftId, to_email: emailProspect.email, subject, body: reviewBody }),
      });
      if (!res.ok) throw new Error("Send failed");
      setBanner("Email queued");
      setEmailProspect(null);
      setEmailPreview(null);
      setReviewOpen(false);
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

  const draftsByProspect = useMemo(() => {
    const map: Record<string, DraftRow> = {};
    for (const d of drafts) {
      const pid = String(d.prospect_id || "");
      if (!pid) continue;
      if (!map[pid]) map[pid] = d;
    }
    return map;
  }, [drafts]);

  const enrichmentCards = useMemo(() => {
    return prospects
      .map((p) => {
        const intel = parseDomainIntel(p.recent_activity);
        if (!intel) return null;
        return { id: p.id, company: p.company || p.domain || p.name, domain: p.domain || "", status: stageForProspect(p).label, summary: intel.summary, hook: intel.hooks[0] || "" };
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{ id: string; company: string; domain: string; status: string; summary: string; hook: string }>;
  }, [prospects, queueJobs]);

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        {banner && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">{banner}</div>}
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">{error}</div>}

        {reviewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Review Draft</div>
                  <div className="mt-1 text-xs text-slate-500">{emailProspect?.name || "—"} • {emailProspect?.domain || "—"} • {emailProspect?.email || "—"}</div>
                </div>
                <button onClick={() => setReviewOpen(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Close</button>
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-700">Subject</div>
                <input value={reviewSubject} onChange={(e) => setReviewSubject(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Subject line" />
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-slate-700">Preview</div>
                  <button onClick={() => setShowFullDraft((v) => !v)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">{showFullDraft ? "Hide full" : "Edit full"}</button>
                </div>
                {!showFullDraft ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {reviewBody.replace(/\s+/g, " ").trim().slice(0, 220)}{reviewBody.length > 220 ? "…" : ""}
                  </div>
                ) : (
                  <textarea value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} rows={10} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" />
                )}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {(() => {
                  const intel = parseDomainIntel(emailProspect?.recent_activity || "");
                  const hook = (intel?.hooks || [])[0] || "";
                  const reasoning = emailPreview?.reasoning || "";
                  const text = hook || reasoning;
                  return text ? text : "No rationale available yet. Run domain enrichment for stronger context.";
                })()}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-slate-500">{campaign?.require_manual_review ? "Manual review enabled" : "AI auto-send enabled"}</div>
                <button onClick={sendNow} disabled={emailSending || !emailProspect?.email || !reviewBody || !reviewSubject} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">Approve & Queue</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} className="min-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-lg font-semibold" />
            <button onClick={saveName} disabled={savingName} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60">Save</button>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full border px-3 py-1 text-xs ${campaign?.status === "active" ? "border-green-200 bg-green-50 text-green-700" : campaign?.status === "paused" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-700"}`}>{(campaign?.status || "").toUpperCase()}</span>
            <button onClick={toggleStatus} disabled={togglingStatus} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60">{campaign?.status === "active" ? "Pause" : "Activate"}</button>
          </div>
        </div>
        <div className="mt-1 text-xs text-slate-500">Last run {timeAgo(campaign?.last_run_at)} • Next scheduled {fromNow(campaign?.schedule_start)}</div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-800">Workflow Controls</div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={huntNow} disabled={controlBusy === "hunt"} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-60">Run Hunt</button>
            <button onClick={sendEmails} disabled={controlBusy === "send"} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-60">Send Campaign</button>
            <button onClick={runFollowups} disabled={controlBusy === "followup"} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-60">Run Follow-ups</button>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-medium">Sending mode</div>
              <div className="mt-0.5 text-xs text-slate-500">{campaign?.require_manual_review ? "Manual review required" : "AI auto-send (default)"}</div>
            </div>
            <button onClick={toggleManualReview} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">{campaign?.require_manual_review ? "Switch to AI auto-send" : "Switch to manual review"}</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setImportFile(e.currentTarget.files?.[0] || null)}
                className="text-xs text-slate-700"
              />
            </div>
            <button
              onClick={importCsvToCampaign}
              disabled={!importFile || importing}
              className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {importing ? "Importing..." : "Import CSV"}
            </button>
            <div className="text-xs text-slate-500">
              CSV headers supported: email, domain, company, name, title, industry, linkedin_url, notes.
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button onClick={() => router.push(`/dashboard/hunting/create?edit=${id}`)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">Edit Settings</button>
            <button onClick={exportCsv} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">Export</button>
            <button onClick={pauseCampaign} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">Pause</button>
            <button onClick={deleteCampaign} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">Delete</button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Prospects</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.found_count ?? prospects.length}</div>
            <div className="mt-2 text-xs text-slate-500">+{todayDelta.f} today</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Sent</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.contacted_count ?? prospects.filter((p) => p.last_email_sent).length}</div>
            <div className="mt-2 text-xs text-slate-500">+{todayDelta.c} today</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Replies</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.replied_count ?? prospects.filter((p) => p.replied).length}</div>
            <div className="mt-2 text-xs text-slate-500">+{todayDelta.r} today</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Meetings</div>
            <div className="mt-1 text-2xl font-bold">{campaign?.booked_count ?? prospects.filter((p) => p.meeting_booked).length}</div>
            <div className="mt-2 text-xs text-slate-500">+{todayDelta.m} today</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-800">Prospects</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setStatusFilter("all")} className={`rounded px-3 py-1 text-xs ${statusFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>All</button>
              <button onClick={() => setStatusFilter("new")} className={`rounded px-3 py-1 text-xs ${statusFilter === "new" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>New</button>
              <button onClick={() => setStatusFilter("contacted")} className={`rounded px-3 py-1 text-xs ${statusFilter === "contacted" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Contacted</button>
              <button onClick={() => setStatusFilter("replied")} className={`rounded px-3 py-1 text-xs ${statusFilter === "replied" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Replied</button>
              <button onClick={() => setStatusFilter("meeting")} className={`rounded px-3 py-1 text-xs ${statusFilter === "meeting" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Meeting Booked</button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={bulkEnrichDomains} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Enrich Domains</button>
              <button onClick={bulkGenerateEmails} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Generate Outreach</button>
              <button onClick={bulkSendSelected} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Queue Sends</button>
              <button onClick={bulkArchive} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Archive</button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-slate-800">Enrichment</div>
            <div className="mt-1 text-xs text-slate-500">Company summaries and personalization hooks from domain evidence.</div>
            {enrichmentCards.length === 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No enrichment results yet. Select domains and run “Enrich Domains”.</div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {enrichmentCards.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{c.company}</div>
                        <div className="truncate text-xs text-slate-500">{c.domain || "—"}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{c.status}</span>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">{c.summary || "—"}</div>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{c.hook || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-800">Drafts</div>
                <div className="mt-1 text-xs text-slate-500">Subject + preview + rationale. Review before queuing if needed.</div>
              </div>
              <button onClick={loadDrafts} className="rounded border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">Refresh</button>
            </div>
            {draftsError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{draftsError}</div>}
            {drafts.length === 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No drafts yet. Run “Generate Outreach”.</div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-600">
                      <th className="p-2 text-left">Prospect</th>
                      <th className="p-2 text-left">Subject</th>
                      <th className="p-2 text-left">Preview</th>
                      <th className="p-2 text-left">Rationale</th>
                      <th className="p-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.slice(0, 25).map((d) => {
                      const p = prospects.find((x) => x.id === d.prospect_id);
                      const subject = String((d.subject_lines || [])[0] || "").trim() || "—";
                      const preview = String(d.body || "").replace(/\s+/g, " ").trim().slice(0, 120) || "—";
                      const intel = parseDomainIntel(p?.recent_activity || "");
                      const rationale = (intel?.hooks || [])[0] || "—";
                      return (
                        <tr key={d.id} className="border-t border-slate-100">
                          <td className="p-2">{p?.name || d.prospect_id}</td>
                          <td className="p-2">{subject}</td>
                          <td className="p-2 text-slate-600">{preview}{String(d.body || "").length > 120 ? "…" : ""}</td>
                          <td className="p-2 text-slate-600">{rationale}</td>
                          <td className="p-2">
                            <button onClick={() => openReviewDraft(d)} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Review</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-600">
                  <th className="p-2 text-left"><input type="checkbox" onChange={(e) => { const checked = e.currentTarget.checked; const next: Record<string, boolean> = {}; for (const p of filteredProspects) next[p.id] = checked; setSelected(next); }} /></th>
                  <th className="p-2 text-left">Prospect</th>
                  <th className="p-2 text-left">Company</th>
                  <th className="p-2 text-left">Domain</th>
                  <th className="p-2 text-left">Title</th>
                  <th className="p-2 text-left">Score</th>
                  <th className="p-2 text-left">Stage</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProspects.map((p) => {
                  const stage = stageForProspect(p);
                  const stageClass =
                    stage.tone === "green"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : stage.tone === "blue"
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : stage.tone === "amber"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : stage.tone === "red"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-slate-200 bg-slate-50 text-slate-700";
                  const scoreClass = p.ai_score == null ? "bg-slate-100 text-slate-700" : p.ai_score > 70 ? "bg-green-50 text-green-700" : p.ai_score >= 40 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";
                  const draft = draftsByProspect[p.id] || null;
                  return (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="p-2"><input type="checkbox" checked={!!selected[p.id]} onChange={(e) => toggleSelected(p.id, e.currentTarget.checked)} /></td>
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{p.company || "—"}</td>
                      <td className="p-2">{p.domain || "—"}</td>
                      <td className="p-2">{p.title || "—"}</td>
                      <td className="p-2"><span className={`rounded px-2 py-1 text-xs ${scoreClass}`}>{p.ai_score ?? 0}</span></td>
                      <td className="p-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${stageClass}`}>{stage.label}</span></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => (draft ? openReviewDraft(draft) : openEmailModal(p))} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">{draft ? "Review draft" : "Generate + review"}</button>
                          <button onClick={async () => { if (!supabase) return; await supabase.from("prospects").update({ status: "archived" }).eq("id", p.id); setBanner("Archived"); }} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">Archive</button>
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
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">Activity</div>
            <div className="space-y-3">
              {runs.length === 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No activity yet</div>
              ) : (
                runs.map((r) => (
                  <div key={r.id} className="flex items-start gap-3">
                    <div className={`mt-1 h-2 w-2 rounded-full ${r.run_type === "hunt" ? "bg-blue-500" : r.run_type === "email" ? "bg-purple-500" : "bg-amber-500"}`}></div>
                    <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleTimeString()}</div>
                      <div className="text-sm">{r.run_type === "hunt" ? "Found prospects" : r.run_type === "email" ? "Sent emails" : "Ran follow-ups"}{r.result_summary ? ` • ${r.result_summary}` : ""}</div>
                      <div className="mt-1 text-xs"><span className={`rounded-full border px-2 py-0.5 ${r.status === "success" ? "border-green-200 bg-green-50 text-green-700" : r.status === "partial" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>{r.status.toUpperCase()}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">Queue Status</div>
              <div className="flex items-center gap-2">
                <button onClick={loadQueue} disabled={queueBusy} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh</button>
                <button onClick={retryDeadJobs} disabled={queueBusy || queueJobs.every((j) => j.status !== "dead")} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60">Retry dead</button>
              </div>
            </div>
            {queueError && <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">{queueError}</div>}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="text-slate-500">Queued</div><div className="mt-1 text-lg font-bold">{queueCounts?.queued ?? 0}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="text-slate-500">Running</div><div className="mt-1 text-lg font-bold">{queueCounts?.running ?? 0}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="text-slate-500">Succeeded</div><div className="mt-1 text-lg font-bold">{queueCounts?.succeeded ?? 0}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="text-slate-500">Failed</div><div className="mt-1 text-lg font-bold">{queueCounts?.failed ?? 0}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><div className="text-slate-500">Dead</div><div className="mt-1 text-lg font-bold">{queueCounts?.dead ?? 0}</div></div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-600">
                    <th className="p-2 text-left">Updated</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Attempts</th>
                    <th className="p-2 text-left">Run After</th>
                    <th className="p-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {queueJobs.length === 0 ? (
                    <tr><td className="p-2 text-slate-500" colSpan={6}>No jobs for this campaign</td></tr>
                  ) : (
                    queueJobs.map((j) => (
                      <tr key={j.id} className="border-t border-slate-100">
                        <td className="p-2 text-slate-500">{new Date(j.updated_at).toLocaleTimeString()}</td>
                        <td className="p-2">{j.type}</td>
                        <td className="p-2">{j.status}</td>
                        <td className="p-2">{j.attempts}/{j.max_attempts}</td>
                        <td className="p-2 text-slate-500">{new Date(j.run_after).toLocaleTimeString()}</td>
                        <td className="p-2 text-slate-500">{(j.last_error || "").slice(0, 90) || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">Targeting</div>
            <div className="text-sm text-slate-700">{campaign?.target_summary || "—"}</div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Titles: {(campaign?.titles || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Industries: {(campaign?.industries || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Locations: {(campaign?.locations || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Company Size: {campaign?.size_min ?? ""} - {campaign?.size_max ?? ""}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Keywords: {(campaign?.keywords || [])?.join(", ") || "—"}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">Exclude: {(campaign?.exclude_companies || [])?.join(", ") || "—"}</div>
            </div>
            <div className="mt-3"><button onClick={() => router.push(`/dashboard/hunting/create?edit=${id}`)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">Quick Edit</button></div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-sm font-semibold text-slate-800">Metrics</div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={responseSeries}>
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rate" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={segmentBars}>
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="rate" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
