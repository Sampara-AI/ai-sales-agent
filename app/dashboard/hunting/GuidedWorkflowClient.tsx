"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Campaign = { id: string; name: string | null };
type Prospect = {
  id: string;
  created_at?: string | null;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  domain?: string | null;
  status?: string | null;
  recent_activity?: string | null;
  last_email_sent?: string | null;
};
type Draft = {
  id: string;
  prospect_id: string;
  subject_lines: string[] | null;
  body: string;
  status: string;
  created_at: string;
};

type StepKey = "upload" | "enrich" | "generate" | "review" | "approve" | "send";
type WorkflowStage = "start" | "uploaded" | "enriched" | "reviewing" | "approved" | "sending" | "sent" | "classified";

function isValidEmail(email: string) {
  return /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
}

const DEMO_MAX_ROWS = 5;

function sanitizeEnterpriseCopy(text: string) {
  const t = String(text || "");
  return t
    .replace(/sampara ai/gi, "VPersonalize")
    .replace(/\btuple ai\b/gi, "VPersonalize")
    .replace(/\bmerch\b/gi, "merchandise")
    .replace(/not enough information( is| was)? available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/not enough information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/limited information available about the prospect/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/limited information available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/insufficient information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.");
}

function extractSection(text: string, header: string) {
  const t = String(text || "");
  const lines = t.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === header.toLowerCase());
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z].*:\s*$/.test(line.trim())) break;
    const m = line.trim().match(/^- (.+)$/);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

function extractInlineValue(text: string, prefix: string) {
  const t = String(text || "");
  const m = t.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*(.+)$`, "im"));
  return m?.[1] ? String(m[1]).trim() : "";
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />;
}

export default function GuidedWorkflowClient(props: {
  campaigns: Campaign[];
  initialCampaignId: string;
  initialProspects: Prospect[];
  initialDrafts: Draft[];
  initialStep: StepKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [campaignId, setCampaignId] = useState(props.initialCampaignId);
  const [step, setStep] = useState<StepKey>(props.initialStep);
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(() => {
    const valid = (props.initialProspects || []).filter((p) => isValidEmail(String(p.email || "").trim().toLowerCase()));
    if (valid.length === 0) return "start";
    const allEnriched = valid.length > 0 && valid.every((p) => String(p.status || "") === "researched");
    if ((props.initialDrafts || []).length > 0) return "reviewing";
    if (allEnriched) return "enriched";
    return "uploaded";
  });
  const [prospects, setProspects] = useState<Prospect[]>(props.initialProspects);
  const [drafts, setDrafts] = useState<Draft[]>(props.initialDrafts);

  const [busy, setBusy] = useState<null | { step: StepKey | "replies"; label: string }>(null);
  const [banner, setBanner] = useState<string>("");
  const [rowState, setRowState] = useState<
    Record<
      string,
      {
        state: string;
        error?: string;
        reasoning?: string;
        knowledge_preview?: string;
        knowledge_used?: boolean;
        draft_subject?: string;
        draft_body?: string;
        sent_at?: string;
        personalization_score?: number;
        confidence_score?: number;
      }
    >
  >({});

  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const [replyInput, setReplyInput] = useState({ from_email: "", to_email: "", subject: "", body: "", auto_send: false });
  const [replyDraft, setReplyDraft] = useState<any | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<null | { current: number; total: number; label: string }>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewProspectId, setReviewProspectId] = useState<string | null>(null);

  const refs = {
    top: useRef<HTMLDivElement | null>(null),
    upload: useRef<HTMLDivElement | null>(null),
    enrich: useRef<HTMLDivElement | null>(null),
    generate: useRef<HTMLDivElement | null>(null),
    review: useRef<HTMLDivElement | null>(null),
    approve: useRef<HTMLDivElement | null>(null),
    send: useRef<HTMLDivElement | null>(null),
  };

  const draftByProspect = useMemo(() => {
    const map: Record<string, Draft> = {};
    for (const d of drafts) {
      if (!map[d.prospect_id]) map[d.prospect_id] = d;
    }
    return map;
  }, [drafts]);

  const activeProspects = useMemo(() => {
    const valid = prospects.filter((p) => isValidEmail(String(p.email || "").trim().toLowerCase()));
    return valid.slice(0, DEMO_MAX_ROWS);
  }, [prospects]);

  const unlock = useMemo(() => {
    const hasProspects = activeProspects.length > 0;
    const anyDrafted =
      Object.keys(draftByProspect).length > 0 || activeProspects.some((p) => !!String(rowState[p.id]?.draft_body || "").trim());
    const anyApproved = Object.values(approved).some(Boolean);
    if (!hasProspects) {
      return { upload: true, enrich: false, generate: false, review: false, approve: false, send: false };
    }
    switch (workflowStage) {
      case "start":
        return { upload: true, enrich: false, generate: false, review: false, approve: false, send: false };
      case "uploaded":
        return { upload: true, enrich: true, generate: false, review: anyDrafted, approve: anyDrafted, send: anyApproved };
      case "enriched":
        return { upload: true, enrich: true, generate: true, review: anyDrafted, approve: anyDrafted, send: anyApproved };
      case "reviewing":
        return { upload: true, enrich: true, generate: true, review: true, approve: true, send: anyApproved };
      case "approved":
        return { upload: true, enrich: true, generate: true, review: true, approve: true, send: true };
      case "sending":
        return { upload: true, enrich: true, generate: true, review: true, approve: true, send: true };
      case "sent":
        return { upload: true, enrich: true, generate: true, review: true, approve: true, send: true };
      case "classified":
        return { upload: true, enrich: true, generate: true, review: true, approve: true, send: true };
      default:
        return { upload: true, enrich: true, generate: false, review: anyDrafted, approve: anyDrafted, send: anyApproved };
    }
  }, [activeProspects, draftByProspect, rowState, approved, workflowStage]);

  useEffect(() => {
    const hasProspects = activeProspects.length > 0;
    const allEnriched = hasProspects && activeProspects.every((p) => String(p.status || "") === "researched");
    const anyDrafted =
      Object.keys(draftByProspect).length > 0 || activeProspects.some((p) => !!String(rowState[p.id]?.draft_body || "").trim());
    const anyApproved = Object.values(approved).some(Boolean);

    let next = workflowStage;
    if (next === "start" && hasProspects) next = "uploaded";
    if (next === "uploaded" && allEnriched) next = "enriched";
    if ((next === "uploaded" || next === "enriched") && anyDrafted) next = "reviewing";
    if (next === "reviewing" && anyApproved) next = "approved";

    if (next !== workflowStage) setWorkflowStage(next);
  }, [activeProspects, draftByProspect, rowState, approved, workflowStage]);

  useEffect(() => {
    try {
      const key = `wf_approved_${campaignId}`;
      const raw = window.localStorage.getItem(key);
      if (raw) setApproved(JSON.parse(raw));
      else setApproved({});
    } catch {}
    setWorkflowStage("start");
    setRowState({});
    setReplyDraft(null);
    setReviewOpen(false);
    setReviewProspectId(null);
  }, [campaignId]);

  useEffect(() => {
    try {
      const key = `wf_approved_${campaignId}`;
      window.localStorage.setItem(key, JSON.stringify(approved));
    } catch {}
  }, [approved, campaignId]);

  useEffect(() => {
    const spCampaign = searchParams.get("campaign") || campaignId;
    const spStep = (searchParams.get("step") || step) as StepKey;
    if (spCampaign && spCampaign !== campaignId) setCampaignId(spCampaign);
    if (spStep && spStep !== step) setStep(spStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setUrl = (nextCampaign: string, nextStep: StepKey) => {
    router.replace(`/dashboard/hunting?campaign=${encodeURIComponent(nextCampaign)}&step=${encodeURIComponent(nextStep)}`);
  };

  const scrollTo = (k: StepKey) => {
    const el =
      k === "upload"
        ? refs.upload.current
        : k === "enrich"
          ? refs.enrich.current
          : k === "generate"
            ? refs.generate.current
            : k === "review"
              ? refs.review.current
              : k === "approve"
                ? refs.approve.current
                : refs.send.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openReview = (pid: string) => {
    setReviewProspectId(pid);
    setReviewOpen(true);
  };

  const getDraftPreview = (pid: string) => {
    const d = draftByProspect[pid] || null;
    const rs = rowState[pid] || null;
    const subject = sanitizeEnterpriseCopy((d ? String((d.subject_lines || [])[0] || "").trim() : "") || String(rs?.draft_subject || "").trim());
    const body = sanitizeEnterpriseCopy((d ? String(d.body || "").trim() : "") || String(rs?.draft_body || "").trim());
    const reasoning = sanitizeEnterpriseCopy(String(rs?.reasoning || "").trim());
    const knowledgeUsed = Boolean(rs?.knowledge_used);
    const knowledgePreview = sanitizeEnterpriseCopy(String(rs?.knowledge_preview || "").trim());
    const personalizationScore = typeof rs?.personalization_score === "number" ? rs.personalization_score : null;
    const confidenceScore = typeof rs?.confidence_score === "number" ? rs.confidence_score : null;
    return { subject, body, reasoning, knowledgeUsed, knowledgePreview, personalizationScore, confidenceScore };
  };

  const openFirstDraft = () => {
    const first = activeProspects.find((p) => {
      const pv = getDraftPreview(p.id);
      return !!pv.body;
    });
    if (first) openReview(first.id);
  };

  const refresh = async (cid: string) => {
    const p = await fetch(`/api/campaigns/${encodeURIComponent(cid)}/prospects`, { cache: "no-store" }).then((r) => r.json());
    if (p?.success) setProspects(p.prospects || []);
    const d = await fetch(`/api/campaigns/${encodeURIComponent(cid)}/drafts`, { cache: "no-store" }).then((r) => r.json());
    if (d?.success) setDrafts(d.drafts || []);
  };

  const goStep = async (next: StepKey) => {
    if (!unlock[next]) {
      setBanner(
        next === "enrich"
          ? "Upload CSV first."
          : next === "generate"
            ? "Run enrichment first."
            : next === "review" || next === "approve"
              ? "Generate drafts first."
              : "Approve at least one draft first.",
      );
    }
    setStep(next);
    setUrl(campaignId, next);
    requestAnimationFrame(() => scrollTo(next));
  };

  const runUpload = async (file: File) => {
    setBanner("");
    setBusy({ step: "upload", label: "Uploading CSV…" });
    setRowState({});
    setProgress(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/import`, { method: "POST", body: fd, headers: { accept: "application/json" } });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.success) throw new Error(String(j?.error || "CSV import failed"));
      await refresh(campaignId);
      setBanner(`${Number(j.imported || 0) + Number(j.attached_existing || 0)} prospects imported successfully`);
      setWorkflowStage("uploaded");
      setStep("enrich");
      setUrl(campaignId, "enrich");
      scrollTo("enrich");
    } catch (e: any) {
      setBanner(String(e?.message || "CSV import failed"));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const runEnrich = async () => {
    setBanner("");
    setBusy({ step: "enrich", label: "Analyzing domains…" });
    const total = activeProspects.length;
    setProgress({ current: 0, total, label: "Analyzing domain…" });
    const nextState: Record<string, { state: string; error?: string }> = {};
    for (const p of activeProspects) nextState[p.id] = { state: "pending" };
    setRowState(nextState);

    let done = 0;
    for (const p of activeProspects) {
      setRowState((s) => ({ ...s, [p.id]: { state: "enriching" } }));
      try {
        const res = await fetch(`/api/prospects/${encodeURIComponent(p.id)}/enrich-domain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_now: true, enqueue_only: false }),
        });
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.success) throw new Error(String(j?.error || "enrich failed"));
        setRowState((s) => ({ ...s, [p.id]: { state: "enriched" } }));
      } catch (e: any) {
        setRowState((s) => ({ ...s, [p.id]: { state: "failed", error: String(e?.message || "enrich failed") } }));
      }
      done += 1;
      setProgress({ current: done, total, label: "Generating personalization…" });
    }

    await refresh(campaignId);
    setBusy(null);
    setProgress(null);
    setBanner("Enrichment complete");
    setWorkflowStage("enriched");
    setStep("generate");
    setUrl(campaignId, "generate");
    scrollTo("generate");
  };

  const runGenerate = async () => {
    setBanner("");
    setBusy({ step: "generate", label: "Generating personalization…" });
    const total = activeProspects.length;
    setProgress({ current: 0, total, label: "Generating drafts…" });

    let done = 0;
    for (const p of activeProspects) {
      setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "pending" }), state: "generating" } }));
      try {
        const res = await fetch(`/api/generate-outreach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospect_id: p.id, enqueue_only: false }),
        });
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok) throw new Error(String(j?.error || "generate failed"));
        const subj = String((j?.subject_lines || [])[0] || "").trim();
        const body = String(j?.email_body || "").trim();
        setRowState((s) => ({
          ...s,
          [p.id]: {
            ...(s[p.id] || { state: "pending" }),
            state: "email_ready",
            draft_subject: subj,
            draft_body: body,
            reasoning: sanitizeEnterpriseCopy(String(j?.reasoning || "").trim()),
            knowledge_used: Boolean(j?.knowledge_used),
            knowledge_preview: sanitizeEnterpriseCopy(String(j?.knowledge_preview || "").trim()),
            personalization_score: typeof j?.personalization_score === "number" ? j.personalization_score : Number(j?.personalization_score ?? 0),
            confidence_score: typeof j?.confidence_score === "number" ? j.confidence_score : Number(j?.confidence_score ?? 0),
          },
        }));
      } catch (e: any) {
        setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "pending" }), state: "failed", error: String(e?.message || "generate failed") } }));
      }
      done += 1;
      setProgress({ current: done, total, label: "Generating drafts…" });
    }

    await refresh(campaignId);
    setBusy(null);
    setProgress(null);
    setBanner("Drafts generated");
    setWorkflowStage("reviewing");
    setStep("review");
    setUrl(campaignId, "review");
    scrollTo("review");
    requestAnimationFrame(() => openFirstDraft());
  };

  const approveAll = () => {
    const next: Record<string, boolean> = {};
    for (const p of activeProspects) {
      const pid = p.id;
      const hasDraft = !!draftByProspect[pid] || !!String(rowState[pid]?.draft_body || "").trim();
      if (hasDraft) next[pid] = true;
    }
    setApproved(next);
    setWorkflowStage("approved");
    setBanner("All drafts approved");
  };

  const runSendApproved = async (forcedProspectIds?: string[]) => {
    setBanner("");
    setBusy({ step: "send", label: "Sending…" });
    setWorkflowStage("sending");

    const forcedSet = new Set((forcedProspectIds || []).filter(Boolean));
    const list = forcedSet.size ? activeProspects.filter((p) => forcedSet.has(p.id)) : activeProspects.filter((p) => approved[p.id]);
    const total = list.length;
    if (total === 0) {
      setBusy(null);
      setBanner("Approve at least one draft first.");
      return;
    }
    setProgress({ current: 0, total, label: "Sending…" });
    let done = 0;
    setRowState((s) => {
      const next = { ...s };
      for (const p of list) next[p.id] = { ...(next[p.id] || { state: "pending" }), state: "queued" };
      return next;
    });
    for (const p of list) {
      const toEmail = String(p.email || "").trim().toLowerCase();
      const d = draftByProspect[p.id] || null;
      const fallbackSubject = String(rowState[p.id]?.draft_subject || "").trim();
      const fallbackBody = String(rowState[p.id]?.draft_body || "").trim();
      const subject = String((d?.subject_lines || [])[0] || fallbackSubject || "Quick question").trim();
      const body = String(d?.body || fallbackBody || "").trim();
      if (!isValidEmail(toEmail) || !body) {
        setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "queued" }), state: "failed", error: "Missing email or draft" } }));
        done += 1;
        setProgress({ current: done, total, label: "Sending…" });
        continue;
      }

      setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "queued" }), state: "sending" } }));
      try {
        const res = await fetch(`/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prospect_id: p.id,
            email_draft_id: d?.id || undefined,
            to_email: toEmail,
            subject,
            body,
            enqueue_only: false,
            run_now: true,
          }),
        });
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.success) throw new Error(String(j?.error || "send failed"));
        setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "sending" }), state: "sent", sent_at: new Date().toISOString() } }));
      } catch (e: any) {
        setRowState((s) => ({ ...s, [p.id]: { ...(s[p.id] || { state: "sending" }), state: "failed", error: String(e?.message || "send failed") } }));
      }
      done += 1;
      setProgress({ current: done, total, label: "Sending…" });
    }

    await refresh(campaignId);
    setBusy(null);
    setProgress(null);
    setBanner("Send complete");
    setWorkflowStage("sent");
    setStep("send");
    setUrl(campaignId, "send");
    scrollTo("send");
  };

  const generateReply = async () => {
    setBanner("");
    setBusy({ step: "replies", label: "Generating response…" });
    setReplyDraft(null);
    try {
      const res = await fetch(`/api/inbox/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...replyInput, send_response: false }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.success) throw new Error(String(j?.error || "reply failed"));
      setReplyDraft(j);
      setWorkflowStage("classified");
      setBanner("Response generated");
    } catch (e: any) {
      setBanner(String(e?.message || "reply failed"));
    } finally {
      setBusy(null);
    }
  };

  const sendReply = async () => {
    if (!replyDraft?.prospect_id) {
      setBanner("Generate response first.");
      return;
    }
    setBusy({ step: "replies", label: "Sending response…" });
    try {
      const res = await fetch(`/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospect_id: replyDraft.prospect_id,
          to_email: replyInput.from_email,
          subject: replyDraft.response_subject || `Re: ${replyInput.subject || "Quick question"}`,
          body: replyDraft.response_body,
          enqueue_only: false,
          run_now: true,
          allow_replied: true,
        }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.success) throw new Error(String(j?.error || "send failed"));
      setBanner("Response sent");
    } catch (e: any) {
      setBanner(String(e?.message || "send failed"));
    } finally {
      setBusy(null);
    }
  };

  const onStepClick = async (k: StepKey) => {
    if (k === "enrich") {
      if (!unlock.enrich) return goStep("enrich");
      await goStep("enrich");
      await runEnrich();
      return;
    }
    if (k === "generate") {
      if (!unlock.generate) return goStep("generate");
      await goStep("generate");
      await runGenerate();
      return;
    }
    if (k === "send") {
      if (!unlock.approve) {
        setBanner("Generate drafts first.");
        return;
      }
      if (!unlock.send) {
        setBanner("Approve at least one draft first.");
        await goStep("approve");
        return;
      }
      return goStep("send");
    }
    return goStep(k);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" ref={refs.top}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Guided Workflow</div>
          <div className="mt-1 text-sm text-slate-600">What happened, what’s happening, and what happens next.</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={campaignId}
            onChange={async (e) => {
              const next = e.currentTarget.value;
              setCampaignId(next);
              setStep("upload");
              setUrl(next, "upload");
              await refresh(next);
              setRowState({});
              setBanner("");
              scrollTo("upload");
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {props.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "Campaign"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {banner && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          {busy ? (
            <div className="flex items-center gap-2">
              <Spinner />
              <span>
                {busy.label}
                {progress ? ` (${progress.current}/${progress.total})` : ""}
              </span>
            </div>
          ) : (
            banner
          )}
        </div>
      )}

      {!banner && busy && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          <div className="flex items-center gap-2">
            <Spinner />
            <span>
              {busy.label}
              {progress ? ` (${progress.current}/${progress.total})` : ""}
            </span>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-6">
        {([
          { key: "upload", label: "1 Upload CSV" },
          { key: "enrich", label: "2 Enrich" },
          { key: "generate", label: "3 Generate Drafts" },
          { key: "review", label: "4 Review Drafts" },
          { key: "approve", label: "5 Approve" },
          { key: "send", label: "6 Send" },
        ] as Array<{ key: StepKey; label: string }>).map((s) => {
          const enabled = !!unlock[s.key] || s.key === "upload" || s.key === "review" || s.key === "approve";
          const active = step === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!!busy}
              onClick={() => onStepClick(s.key)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : enabled
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              {s.label} <span>→</span>
            </button>
          );
        })}
      </div>

      {unlock.review && (
        <div className="sticky bottom-0 z-20 mt-4 rounded-2xl border border-slate-200 bg-white/95 p-3 backdrop-blur">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">Workflow:</span> {workflowStage === "reviewing" ? "Review drafts" : workflowStage === "approved" ? "Approved" : workflowStage === "sending" ? "Sending" : workflowStage === "sent" ? "Sent" : "In progress"}
              {progress ? ` • ${progress.current}/${progress.total}` : ""}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  openFirstDraft();
                  setBanner("Review drafts, then approve and send.");
                }}
                disabled={!!busy}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
              >
                Review All Drafts
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ids = activeProspects
                    .map((p) => p.id)
                    .filter((id) => {
                      const pv = getDraftPreview(id);
                      return !!pv.body;
                    });
                  approveAll();
                  setStep("send");
                  setUrl(campaignId, "send");
                  requestAnimationFrame(() => scrollTo("send"));
                  await runSendApproved(ids);
                }}
                disabled={!!busy}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white"
              >
                Approve & Send All
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-4">
          <div ref={refs.upload}>
            <div className="text-sm font-semibold text-slate-900">1) Upload CSV</div>
            <div className="mt-1 text-xs text-slate-600">Upload and immediately populate the table. This unlocks enrichment.</div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept=".csv,text/csv"
                className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  setUploadFile(f || null);
                }}
              />
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
                disabled={!uploadFile || !!busy}
                onClick={() => {
                  if (uploadFile) runUpload(uploadFile);
                }}
              >
                Upload CSV
              </button>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => onStepClick("enrich")}
                disabled={!unlock.enrich || !!busy}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
                  unlock.enrich && !busy ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                Next <span>→</span>
              </button>
            </div>
          </div>

          <div ref={refs.enrich}>
            <div className="text-sm font-semibold text-slate-900">2) Enrich</div>
            <div className="mt-1 text-xs text-slate-600">Analyzing domain → generating personalization → enrichment complete.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onStepClick("enrich")}
                disabled={!unlock.enrich || !!busy}
                className={`rounded-xl px-4 py-2 text-sm ${unlock.enrich && !busy ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                2 Enrich →
              </button>
              <button
                type="button"
                onClick={() => onStepClick("generate")}
                disabled={!unlock.generate || !!busy}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
                  unlock.generate && !busy ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                Next <span>→</span>
              </button>
            </div>
          </div>

          <div ref={refs.generate}>
            <div className="text-sm font-semibold text-slate-900">3) Generate personalized emails</div>
            <div className="mt-1 text-xs text-slate-600">Generates subject + email body and stores draft for review.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onStepClick("generate")}
                disabled={!unlock.generate || !!busy}
                className={`rounded-xl px-4 py-2 text-sm ${unlock.generate && !busy ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                3 Generate →
              </button>
              <button
                type="button"
                onClick={() => {
                  goStep("review");
                  requestAnimationFrame(() => openFirstDraft());
                }}
                disabled={!unlock.review || !!busy}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
                  unlock.review && !busy ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                Next <span>→</span>
              </button>
            </div>
          </div>

          <div ref={refs.review}>
            <div className="text-sm font-semibold text-slate-900">4) Review</div>
            <div className="mt-1 text-xs text-slate-600">After generation, the first draft auto-opens. Use “Review email” in the table to open any draft.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  openFirstDraft();
                  setBanner("Review drafts, then approve to enable sending.");
                }}
                disabled={!!busy || !unlock.review}
                className={`rounded-xl px-4 py-2 text-sm ${!busy && unlock.review ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                Review All Drafts
              </button>
              <button
                type="button"
                onClick={approveAll}
                disabled={!!busy || !unlock.review}
                className={`rounded-xl border px-4 py-2 text-sm ${
                  !busy && unlock.review ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-white text-slate-400"
                }`}
              >
                Approve All Drafts
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ids = activeProspects
                    .map((p) => p.id)
                    .filter((id) => {
                      const pv = getDraftPreview(id);
                      return !!pv.body;
                    });
                  approveAll();
                  setStep("send");
                  setUrl(campaignId, "send");
                  requestAnimationFrame(() => scrollTo("send"));
                  await runSendApproved(ids);
                }}
                disabled={!!busy || !unlock.review}
                className={`rounded-xl px-4 py-2 text-sm ${!busy && unlock.review ? "bg-emerald-600 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                Approve & Send All
              </button>
              <button
                type="button"
                onClick={() => goStep("approve")}
                disabled={!!busy || !unlock.review}
                className={`rounded-xl border px-4 py-2 text-sm ${
                  !busy && unlock.review ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-white text-slate-400"
                }`}
              >
                Continue to Approve <span>→</span>
              </button>
            </div>
          </div>

          <div ref={refs.approve}>
            <div className="text-sm font-semibold text-slate-900">5) Approve</div>
            <div className="mt-1 text-xs text-slate-600">Approve drafts to enable sending. Approve All enables “Send all approved”.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={approveAll}
                disabled={!!busy}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Approve all
              </button>
              <button
                type="button"
                onClick={() => goStep("send")}
                disabled={!!busy}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
              >
                Continue to Send →
              </button>
            </div>
          </div>

          <div ref={refs.send}>
            <div className="text-sm font-semibold text-slate-900">6) Send</div>
            <div className="mt-1 text-xs text-slate-600">queued → sending → sent → failed. Failures show inline error.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runSendApproved()}
                disabled={!!busy}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
              >
                Send all approved
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-left">{step === "approve" || step === "send" ? "Approve" : ""}</th>
              <th className="p-2 text-left">Prospect</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">State</th>
              <th className="p-2 text-left">Draft</th>
            </tr>
          </thead>
          <tbody>
            {prospects.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-600" colSpan={5}>
                  Upload a CSV to populate prospects.
                </td>
              </tr>
            ) : (
              activeProspects.map((p) => {
                const pid = p.id;
                const d = draftByProspect[pid] || null;
                const rs = rowState[pid] || null;
                const state = rs?.state || String(p.status || "pending");
                const err = rs?.error || "";
                const reasoning = sanitizeEnterpriseCopy(String(rs?.reasoning || "").trim());
                const knowledgeUsed = Boolean(rs?.knowledge_used);
                const knowledgePreview = sanitizeEnterpriseCopy(String(rs?.knowledge_preview || "").trim());
                const fallbackSubj = String(rs?.draft_subject || "").trim();
                const fallbackBody = String(rs?.draft_body || "").trim();
                const subj = sanitizeEnterpriseCopy(d ? String((d.subject_lines || [])[0] || "").trim() : fallbackSubj);
                const body = sanitizeEnterpriseCopy(d ? String(d.body || "").trim() : fallbackBody);
                const preview = body ? body.replace(/\s+/g, " ").slice(0, 120) + (body.length > 120 ? "…" : "") : "No draft yet";
                const rationale = sanitizeEnterpriseCopy(String(p.recent_activity || "").trim());

                return (
                  <tr
                    key={pid}
                    className={`border-t border-slate-100 ${reviewProspectId === pid ? "bg-amber-50" : ""}`}
                  >
                    <td className="p-2">
                      {step === "approve" || step === "send" ? (
                        <input
                          type="checkbox"
                          checked={!!approved[pid]}
                          onChange={(e) => setApproved((s) => ({ ...s, [pid]: e.currentTarget.checked }))}
                          disabled={(!d && !body) || !!busy}
                          className="h-4 w-4"
                        />
                      ) : null}
                    </td>
                    <td className="p-2">{String(p.name || p.company || p.domain || "—")}</td>
                    <td className="p-2">{String(p.email || "—")}</td>
                    <td className="p-2">
                      {(() => {
                        const sentAt = String(rs?.sent_at || p.last_email_sent || "").trim();
                        const draftReady = !!body;
                        const approvedFlag = !!approved[pid];
                        const normalized = String(state || "").toLowerCase();
                        let label = "pending";
                        let cls = "bg-slate-100 text-slate-700 border-slate-200";
                        if (normalized === "failed") {
                          label = "failed";
                          cls = "bg-rose-50 text-rose-700 border-rose-200";
                        } else if (normalized === "sent") {
                          label = "sent";
                          cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        } else if (normalized === "sending") {
                          label = "sending";
                          cls = "bg-sky-50 text-sky-700 border-sky-200";
                        } else if (normalized === "queued") {
                          label = "queued";
                          cls = "bg-slate-50 text-slate-700 border-slate-200";
                        } else if (approvedFlag) {
                          label = "approved";
                          cls = "bg-violet-50 text-violet-700 border-violet-200";
                        } else if (draftReady) {
                          label = "draft_ready";
                          cls = "bg-amber-50 text-amber-800 border-amber-200";
                        } else if (normalized === "email_ready") {
                          label = "draft_ready";
                          cls = "bg-amber-50 text-amber-800 border-amber-200";
                        } else if (normalized === "researched" || normalized === "enriched") {
                          label = "enriched";
                          cls = "bg-slate-50 text-slate-700 border-slate-200";
                        }
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>
                                {label}
                                {label === "sending" ? <Spinner /> : null}
                              </span>
                              {sentAt ? <span className="text-xs text-slate-500">Sent {new Date(sentAt).toLocaleString()}</span> : null}
                            </div>
                          </div>
                        );
                      })()}
                      {err && <div className="mt-1 text-xs text-rose-700">{err}</div>}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-2">
                        <div className="text-sm text-slate-900">{subj || "Draft not generated yet"}</div>
                        <div className="text-xs text-slate-600">{preview}</div>
                        <button
                          type="button"
                          onClick={() => openReview(pid)}
                          disabled={!body || !!busy}
                          className={`w-fit rounded-xl px-3 py-1.5 text-sm ${
                            body && !busy ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"
                          }`}
                        >
                          Review email →
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {prospects.length > DEMO_MAX_ROWS && (
        <div className="mt-3 text-xs text-slate-500">
          Showing first {DEMO_MAX_ROWS} rows for a smooth demo. Upload 5 for best results.
        </div>
      )}

      {reviewOpen && reviewProspectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            {(() => {
              const p = activeProspects.find((x) => x.id === reviewProspectId) || null;
              const pv = getDraftPreview(reviewProspectId);
              const subject = pv.subject || "Draft email";
              const body = pv.body || "";
              const rawEvidence = sanitizeEnterpriseCopy(String(p?.recent_activity || "").trim());
              const sources = extractSection(rawEvidence, "Sources:");
              const keyPoints = extractSection(rawEvidence, "Key points:");
              const signals = extractSection(rawEvidence, "Operational signals:");
              const friction = extractSection(rawEvidence, "Likely operational friction:");
              const matchAngle = extractSection(rawEvidence, "Match angle:");
              const confidence = extractInlineValue(rawEvidence, "Confidence:");
              const grounding = pv.knowledgePreview;
              const groundingStatus = pv.knowledgeUsed ? "KB used" : "KB not used";
              const draftConf = pv.confidenceScore != null && Number.isFinite(pv.confidenceScore) ? Math.max(0, Math.min(100, pv.confidenceScore)) : null;
              const draftPers = pv.personalizationScore != null && Number.isFinite(pv.personalizationScore) ? Math.max(0, Math.min(100, pv.personalizationScore)) : null;
              return (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">Email draft</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{subject}</div>
                      <div className="mt-1 text-xs text-slate-600">{String(p?.email || "")}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setApproved((s) => ({ ...s, [reviewProspectId]: true }));
                          setBanner("Draft approved");
                        }}
                        disabled={!!busy || !body}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReviewOpen(false);
                          setReviewProspectId(null);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-700">Email to be sent</div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{body || "Draft not available yet."}</pre>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold text-slate-700">Personalization evidence</div>
                      <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                        {keyPoints.length
                          ? `Key points:\n- ${keyPoints.join("\n- ")}`
                          : rawEvidence
                            ? rawEvidence
                            : "Imported context + domain intelligence"}
                      </div>
                      {sources.length ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          <div className="font-semibold text-slate-800">Sources</div>
                          <div className="mt-1 whitespace-pre-wrap">{`- ${sources.join("\n- ")}`}</div>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700">Signals + grounding</div>
                        <div className="text-xs text-slate-500">{groundingStatus}</div>
                      </div>
                      {confidence ? <div className="mt-2 text-xs text-slate-700">Enrichment confidence: {confidence}</div> : null}
                      {draftConf != null || draftPers != null ? (
                        <div className="mt-2 text-xs text-slate-700">
                          Draft confidence summary: {draftConf != null ? `${draftConf}%` : "—"} • Personalization: {draftPers != null ? `${draftPers}%` : "—"}
                        </div>
                      ) : null}
                      {signals.length ? (
                        <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{`Operational signals:\n- ${signals.join("\n- ")}`}</div>
                      ) : null}
                      {friction.length ? (
                        <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{`Likely friction:\n- ${friction.join("\n- ")}`}</div>
                      ) : null}
                      {matchAngle.length ? (
                        <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{`Match angle:\n- ${matchAngle.join("\n- ")}`}</div>
                      ) : null}
                      {pv.reasoning && <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{pv.reasoning}</div>}
                      {grounding && <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{grounding}</div>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">Reply analysis</div>
          {activeProspects.some((p) => !!String(p.last_email_sent || "").trim()) || activeProspects.some((p) => String(rowState[p.id]?.state || "") === "sent") ? (
            <div className="text-xs text-slate-600">Awaiting reply…</div>
          ) : (
            <div className="text-xs text-slate-600">Send at least one email to analyze a reply.</div>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-600">Incoming Client Reply → Analyze Reply → Signal Classification → Suggested Response</div>

        <div className="mt-3 grid grid-cols-1 gap-2" id="reply">
          <div className="text-xs font-semibold text-slate-700">Incoming Client Reply</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={replyInput.from_email}
              onChange={(e) => setReplyInput((s) => ({ ...s, from_email: e.currentTarget.value }))}
              placeholder="From (client email)"
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900"
              disabled={!!busy}
            />
            <input
              value={replyInput.to_email}
              onChange={(e) => setReplyInput((s) => ({ ...s, to_email: e.currentTarget.value }))}
              placeholder="To (your sending inbox)"
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900"
              disabled={!!busy}
            />
          </div>
          <input
            value={replyInput.subject}
            onChange={(e) => setReplyInput((s) => ({ ...s, subject: e.currentTarget.value }))}
            placeholder="Subject (optional)"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900"
            disabled={!!busy}
          />
          <textarea
            value={replyInput.body}
            onChange={(e) => setReplyInput((s) => ({ ...s, body: e.currentTarget.value }))}
            placeholder="Paste reply body…"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900"
            rows={5}
            disabled={!!busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={generateReply} disabled={!!busy} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
              Analyze Reply
            </button>
            <button type="button" onClick={sendReply} disabled={!!busy || !replyDraft?.response_body} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Send Suggested Response
            </button>
          </div>
        </div>

        {replyDraft?.response_body && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-700">Signal Detected</div>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Signal</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.signal || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Confidence</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.confidence ?? "—")}%</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Recommended next action</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.recommended_action || "—")}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Buying intent</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.buying_intent || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Urgency</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.urgency || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Technical depth</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.technical_depth || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Pricing sensitivity</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.pricing_sensitivity || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Integration complexity</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{String(replyDraft.integration_complexity || "—")}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Objections</div>
                <div className="mt-1 text-xs text-slate-700">
                  {Array.isArray(replyDraft.objections) && replyDraft.objections.length ? replyDraft.objections.join(", ") : "—"}
                </div>
              </div>
            </div>
            {replyDraft.signal_reason && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-700">Reason</div>
                <div className="mt-1 text-xs text-slate-700">{String(replyDraft.signal_reason)}</div>
              </div>
            )}
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Suggested Response</div>
              <div className="mt-1 text-xs font-semibold text-slate-800">{String(replyDraft.response_subject || "Re:")}</div>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{String(replyDraft.response_body)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
