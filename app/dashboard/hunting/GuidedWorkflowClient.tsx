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

type StepKey = "upload" | "enrich" | "generate" | "review" | "send" | "replies";

function isValidEmail(email: string) {
  return /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
}

const DEMO_MAX_ROWS = 10;

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
  const [prospects, setProspects] = useState<Prospect[]>(props.initialProspects);
  const [drafts, setDrafts] = useState<Draft[]>(props.initialDrafts);

  const [busy, setBusy] = useState<null | { step: StepKey; label: string }>(null);
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
      }
    >
  >({});

  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const [replyInput, setReplyInput] = useState({ from_email: "", to_email: "", subject: "", body: "", auto_send: false });
  const [replyDraft, setReplyDraft] = useState<any | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<null | { current: number; total: number; label: string }>(null);

  const refs = {
    top: useRef<HTMLDivElement | null>(null),
    upload: useRef<HTMLDivElement | null>(null),
    enrich: useRef<HTMLDivElement | null>(null),
    generate: useRef<HTMLDivElement | null>(null),
    review: useRef<HTMLDivElement | null>(null),
    send: useRef<HTMLDivElement | null>(null),
    replies: useRef<HTMLDivElement | null>(null),
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
    const enrichedCount = activeProspects.filter((p) => String(p.status || "") === "researched").length;
    const allEnriched = hasProspects && enrichedCount === activeProspects.length;
    const draftsCount = Object.keys(draftByProspect).length;
    const anyDrafted = draftsCount > 0;
    return {
      upload: true,
      enrich: hasProspects,
      generate: allEnriched,
      review: anyDrafted,
      send: anyDrafted,
      replies: true,
    };
  }, [prospects, draftByProspect]);

  useEffect(() => {
    try {
      const key = `wf_approved_${campaignId}`;
      const raw = window.localStorage.getItem(key);
      if (raw) setApproved(JSON.parse(raw));
      else setApproved({});
    } catch {}
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
              : k === "send"
                ? refs.send.current
                : refs.replies.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const refresh = async (cid: string) => {
    const p = await fetch(`/api/campaigns/${encodeURIComponent(cid)}/prospects`, { cache: "no-store" }).then((r) => r.json());
    if (p?.success) setProspects(p.prospects || []);
    const d = await fetch(`/api/campaigns/${encodeURIComponent(cid)}/drafts`, { cache: "no-store" }).then((r) => r.json());
    if (d?.success) setDrafts(d.drafts || []);
  };

  const goStep = async (next: StepKey) => {
    if (!unlock[next]) {
      setBanner(next === "enrich" ? "Upload CSV first." : next === "generate" ? "Run enrichment first." : "Complete previous step first.");
      return;
    }
    setStep(next);
    setUrl(campaignId, next);
    scrollTo(next);
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
            reasoning: String(j?.reasoning || "").trim(),
            knowledge_used: Boolean(j?.knowledge_used),
            knowledge_preview: String(j?.knowledge_preview || "").trim(),
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
    setStep("review");
    setUrl(campaignId, "review");
    scrollTo("review");
  };

  const approveAll = () => {
    const next: Record<string, boolean> = {};
    for (const p of activeProspects) {
      const pid = p.id;
      const hasDraft = !!draftByProspect[pid] || !!String(rowState[pid]?.draft_body || "").trim();
      if (hasDraft) next[pid] = true;
    }
    setApproved(next);
    setBanner("All drafts approved");
  };

  const runSend = async (mode: "selected" | "all") => {
    setBanner("");
    setBusy({ step: "send", label: "Sending…" });

    const list = mode === "all" ? activeProspects : activeProspects.filter((p) => approved[p.id]);
    const total = list.length;
    setProgress({ current: 0, total, label: "Sending…" });
    let done = 0;
    for (const p of list) {
      const toEmail = String(p.email || "").trim().toLowerCase();
      const d = draftByProspect[p.id] || null;
      const fallbackSubject = String(rowState[p.id]?.draft_subject || "").trim();
      const fallbackBody = String(rowState[p.id]?.draft_body || "").trim();
      const subject = String((d?.subject_lines || [])[0] || fallbackSubject || "Quick question").trim();
      const body = String(d?.body || fallbackBody || "").trim();
      if (!isValidEmail(toEmail) || !body) {
        setRowState((s) => ({ ...s, [p.id]: { state: "failed", error: "Missing email or draft" } }));
        done += 1;
        setProgress({ current: done, total, label: "Sending…" });
        continue;
      }

      setRowState((s) => ({ ...s, [p.id]: { state: "sending" } }));
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
        setRowState((s) => ({ ...s, [p.id]: { state: "sent" } }));
      } catch (e: any) {
        setRowState((s) => ({ ...s, [p.id]: { state: "failed", error: String(e?.message || "send failed") } }));
      }
      done += 1;
      setProgress({ current: done, total, label: "Sending…" });
    }

    await refresh(campaignId);
    setBusy(null);
    setProgress(null);
    setBanner("Send complete");
    setStep("replies");
    setUrl(campaignId, "replies");
    scrollTo("replies");
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
          subject: replyDraft.draft_subject || `Re: ${replyInput.subject || "Quick question"}`,
          body: replyDraft.draft_body,
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
          { key: "generate", label: "3 Generate" },
          { key: "review", label: "4 Review" },
          { key: "send", label: "5 Send" },
          { key: "replies", label: "6 Replies" },
        ] as Array<{ key: StepKey; label: string }>).map((s) => {
          const enabled = unlock[s.key];
          const active = step === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!enabled || !!busy}
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
                onClick={() => goStep("review")}
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
            <div className="mt-1 text-xs text-slate-600">Approve individual drafts or approve all.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={approveAll}
                disabled={!unlock.review || !!busy}
                className={`rounded-xl border px-4 py-2 text-sm ${unlock.review && !busy ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"}`}
              >
                Approve all
              </button>
              <button
                type="button"
                onClick={() => goStep("send")}
                disabled={!unlock.review || !!busy}
                className={`rounded-xl px-4 py-2 text-sm ${unlock.review && !busy ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                Continue to Send →
              </button>
            </div>
          </div>

          <div ref={refs.send}>
            <div className="text-sm font-semibold text-slate-900">5) Send</div>
            <div className="mt-1 text-xs text-slate-600">Queued → sending → sent. Failures show inline error.</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runSend("selected")}
                disabled={!unlock.send || !!busy || Object.values(approved).filter(Boolean).length === 0}
                className={`rounded-xl border px-4 py-2 text-sm ${unlock.send && !busy ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"}`}
              >
                Send selected
              </button>
              <button
                type="button"
                onClick={() => runSend("all")}
                disabled={!unlock.send || !!busy}
                className={`rounded-xl px-4 py-2 text-sm ${unlock.send && !busy ? "bg-slate-900 text-white" : "cursor-not-allowed border border-slate-200 bg-white text-slate-400"}`}
              >
                Send all
              </button>
            </div>
          </div>

          <div ref={refs.replies}>
            <div className="text-sm font-semibold text-slate-900">6) Replies</div>
            <div className="mt-1 text-xs text-slate-600">Generate Response → Send Response.</div>

            <div className="mt-3 grid grid-cols-1 gap-2" id="reply">
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
                  Generate Response
                </button>
                <button type="button" onClick={sendReply} disabled={!!busy || !replyDraft?.draft_body} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Send Response
                </button>
              </div>
            </div>

            {replyDraft?.draft_body && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800">{String(replyDraft.draft_subject || "Draft reply")}</div>
                  <div className="text-xs text-slate-500">
                    {String(replyDraft.intent || "—")} • {String(replyDraft.ai_confidence ?? "—")}/100 {replyDraft.escalated ? "• HOT" : ""}
                  </div>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{String(replyDraft.draft_body)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-left">Approve</th>
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
                const reasoning = String(rs?.reasoning || "").trim();
                const knowledgeUsed = Boolean(rs?.knowledge_used);
                const knowledgePreview = String(rs?.knowledge_preview || "").trim();
                const fallbackSubj = String(rs?.draft_subject || "").trim();
                const fallbackBody = String(rs?.draft_body || "").trim();
                const subj = d ? String((d.subject_lines || [])[0] || "").trim() : fallbackSubj;
                const body = d ? String(d.body || "").trim() : fallbackBody;
                const preview = body ? body.replace(/\s+/g, " ").slice(0, 120) + (body.length > 120 ? "…" : "") : "No draft yet";
                const rationale = String(p.recent_activity || "").trim();

                return (
                  <tr key={pid} className="border-t border-slate-100">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={!!approved[pid]}
                        onChange={(e) => setApproved((s) => ({ ...s, [pid]: e.currentTarget.checked }))}
                        disabled={(!d && !body) || !!busy}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="p-2">{String(p.name || p.company || p.domain || "—")}</td>
                    <td className="p-2">{String(p.email || "—")}</td>
                    <td className="p-2">
                      <div className="text-sm text-slate-900">{state}</div>
                      {err && <div className="mt-1 text-xs text-rose-700">{err}</div>}
                    </td>
                    <td className="p-2">
                      <details>
                        <summary className="cursor-pointer text-sm text-slate-900">{subj || "Open draft"}</summary>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{body || preview}</div>
                        {rationale && (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                            <div className="font-semibold text-slate-800">Personalization evidence</div>
                            <div className="mt-1 whitespace-pre-wrap">{rationale}</div>
                          </div>
                        )}
                        {(reasoning || knowledgePreview) && (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-slate-800">Grounding</div>
                              <div className="text-xs text-slate-500">{knowledgeUsed ? "KB used" : "KB not used"}</div>
                            </div>
                            {reasoning && <div className="mt-2 whitespace-pre-wrap">{reasoning}</div>}
                            {knowledgePreview && (
                              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 whitespace-pre-wrap">
                                {knowledgePreview}
                              </div>
                            )}
                          </div>
                        )}
                      </details>
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
          Showing first {DEMO_MAX_ROWS} rows for a smooth demo. Upload 5–10 for best results.
        </div>
      )}
    </div>
  );
}
