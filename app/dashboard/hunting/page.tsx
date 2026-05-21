import { Nunito_Sans } from "next/font/google";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

function isValidEmail(email: string) {
  return /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
}

async function getBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function enrichCampaign(formData: FormData) {
  "use server";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) redirect("/dashboard/hunting");
  const campaignId = String(formData.get("campaign_id") || "").trim();
  if (!campaignId) redirect("/dashboard/hunting");

  const admin = createAdminClient();
  const pRes = await admin.from("prospects").select("id,email").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(250);
  const prospects = (pRes.data || []) as Array<{ id: string; email: string | null }>;

  const baseUrl = await getBaseUrl();
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();

  let enriched = 0;
  let failed = 0;
  for (const p of prospects) {
    const toEmail = String(p.email || "").trim().toLowerCase();
    if (!isValidEmail(toEmail)) continue;
    try {
      const enr = await fetch(`${baseUrl}/api/prospects/${encodeURIComponent(p.id)}/enrich-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
        body: JSON.stringify({ run_now: true, enqueue_only: false }),
        cache: "no-store",
      });
      if (enr.ok) enriched++;
      else failed++;
    } catch {
      failed++;
    }
  }

  redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=generate&enriched=${encodeURIComponent(String(enriched))}&failed=${encodeURIComponent(String(failed))}`);
}

async function generateDrafts(formData: FormData) {
  "use server";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) redirect("/dashboard/hunting");
  const campaignId = String(formData.get("campaign_id") || "").trim();
  if (!campaignId) redirect("/dashboard/hunting");

  const admin = createAdminClient();
  const pRes = await admin.from("prospects").select("id,email").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(250);
  const prospects = (pRes.data || []) as Array<{ id: string; email: string | null }>;

  const baseUrl = await getBaseUrl();
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();

  let drafted = 0;
  let failed = 0;
  let err = "";
  for (const p of prospects) {
    const toEmail = String(p.email || "").trim().toLowerCase();
    if (!isValidEmail(toEmail)) continue;
    try {
      const genRes = await fetch(`${baseUrl}/api/generate-outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
        body: JSON.stringify({ prospect_id: p.id, enqueue_only: false }),
        cache: "no-store",
      });
      if (!genRes.ok) {
        const j = await genRes.json().catch(() => ({} as any));
        if (!err) err = String((j as any)?.error || "generate_failed").slice(0, 120);
        failed++;
        continue;
      }
      drafted++;
    } catch {
      failed++;
    }
  }

  redirect(
    `/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=review&drafted=${encodeURIComponent(String(drafted))}&failed=${encodeURIComponent(String(failed))}${err ? `&error=${encodeURIComponent(err)}` : ""}`,
  );
}

async function sendDrafts(formData: FormData) {
  "use server";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) redirect("/dashboard/hunting");
  const campaignId = String(formData.get("campaign_id") || "").trim();
  if (!campaignId) redirect("/dashboard/hunting");

  const sendMode = String(formData.get("send_mode") || "selected").trim().toLowerCase();
  const selected = formData.getAll("prospect_id").map((v) => String(v || "").trim()).filter(Boolean);

  const admin = createAdminClient();
  const pRes = await admin.from("prospects").select("id,email").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(250);
  const prospects = (pRes.data || []) as Array<{ id: string; email: string | null }>;

  const allowed = new Set<string>(sendMode === "all" ? prospects.map((p) => p.id) : selected);
  const toSend = prospects.filter((p) => allowed.has(p.id));

  const ids = toSend.map((p) => p.id);
  const draftsByProspect = new Map<string, any>();
  if (ids.length > 0) {
    try {
      const dRes = await admin
        .from("email_drafts")
        .select("id,prospect_id,subject_lines,body,status,created_at")
        .in("prospect_id", ids)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(500);
      for (const d of (dRes.data || []) as any[]) {
        const pid = String(d.prospect_id || "").trim();
        if (!pid) continue;
        if (!draftsByProspect.has(pid)) draftsByProspect.set(pid, d);
      }
    } catch {}
  }

  const baseUrl = await getBaseUrl();
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();

  let sent = 0;
  let failed = 0;
  let sendCode = "";
  for (const p of toSend) {
    const toEmail = String(p.email || "").trim().toLowerCase();
    if (!isValidEmail(toEmail)) continue;
    const d = draftsByProspect.get(p.id) || null;
    const subject = String((d?.subject_lines || [])[0] || "Quick question").trim();
    const body = String(d?.body || "").trim();
    if (!body) {
      failed++;
      continue;
    }
    try {
      const sendRes = await fetch(`${baseUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
        body: JSON.stringify({ prospect_id: p.id, to_email: toEmail, subject, body, enqueue_only: false, run_now: true }),
        cache: "no-store",
      });
      if (!sendRes.ok) {
        const j = await sendRes.json().catch(() => ({} as any));
        if (!sendCode) sendCode = String((j as any)?.error || "send_failed").slice(0, 120);
        failed++;
        continue;
      }
      sent++;
    } catch {
      failed++;
    }
  }

  redirect(
    `/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&sent=${encodeURIComponent(String(sent))}&failed=${encodeURIComponent(String(failed))}${sendCode ? `&send_code=${encodeURIComponent(sendCode)}` : ""}`,
  );
}

async function analyzeInboundReply(formData: FormData) {
  "use server";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) redirect("/dashboard/hunting");

  const campaignId = String(formData.get("campaign_id") || "").trim();
  const fromEmail = String(formData.get("from_email") || "").trim().toLowerCase();
  const toEmail = String(formData.get("to_email") || "").trim().toLowerCase();
  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const autoSend = String(formData.get("auto_send") || "").toLowerCase() === "on";

  if (!campaignId) redirect("/dashboard/hunting");
  if (!isValidEmail(fromEmail) || !isValidEmail(toEmail) || !body) redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&reply=invalid#reply`);

  const baseUrl = await getBaseUrl();
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();

  const respondRes = await fetch(`${baseUrl}/api/inbox/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
    body: JSON.stringify({ from_email: fromEmail, to_email: toEmail, subject, body, send_response: false }),
    cache: "no-store",
  });
  const respondJson = await respondRes.json().catch(() => ({} as any));
  if (!respondRes.ok || !(respondJson as any)?.success) {
    const err = String((respondJson as any)?.error || "failed").slice(0, 120);
    const code = err.toLowerCase().includes("openai") ? "missing_openai" : "failed";
    redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&reply=${encodeURIComponent(code)}&error=${encodeURIComponent(err)}#reply`);
  }

  const externalThreadId = String((respondJson as any)?.thread_external_id || "").trim();
  const draftSubject = String((respondJson as any)?.draft_subject || "").trim();
  const draftBody = String((respondJson as any)?.draft_body || "").trim();
  if (!autoSend) redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&thread=${encodeURIComponent(externalThreadId)}&reply=ok#reply`);

  const prospectId = String((respondJson as any)?.prospect_id || "").trim();
  if (!prospectId) redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&thread=${encodeURIComponent(externalThreadId)}&reply=no_prospect#reply`);

  const sendRes = await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
    body: JSON.stringify({
      prospect_id: prospectId,
      to_email: fromEmail,
      subject: draftSubject || `Re: ${subject || "Quick question"}`,
      body: draftBody,
      enqueue_only: false,
      run_now: true,
      allow_replied: true,
    }),
    cache: "no-store",
  });
  if (!sendRes.ok) redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&thread=${encodeURIComponent(externalThreadId)}&reply=send_failed#reply`);

  redirect(`/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&step=replies&thread=${encodeURIComponent(externalThreadId)}&reply=sent#reply`);
}

export default async function HuntingDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const admin = createAdminClient();

  const campaignsRes = await admin.from("hunting_campaigns").select("id,name,created_at").order("created_at", { ascending: false });
  const campaigns = (campaignsRes.data || []) as Array<{ id: string; name: string | null; created_at?: string | null }>;

  const selectedCampaignIdRaw = typeof searchParams?.campaign === "string" ? searchParams?.campaign : "";
  const selectedCampaignId = selectedCampaignIdRaw.trim() || String(campaigns?.[0]?.id || "").trim();

  const stepRaw = typeof searchParams?.step === "string" ? searchParams?.step : "";
  const step = String(stepRaw || "upload").trim().toLowerCase();
  const effectiveStep = step === "upload" || step === "enrich" || step === "generate" || step === "review" || step === "send" || step === "replies" ? step : "upload";

  const imported = typeof searchParams?.import === "string" ? searchParams?.import : "";
  const skipped = typeof searchParams?.skipped === "string" ? searchParams?.skipped : "";
  const enriched = typeof searchParams?.enriched === "string" ? searchParams?.enriched : "";
  const drafted = typeof searchParams?.drafted === "string" ? searchParams?.drafted : "";
  const sent = typeof searchParams?.sent === "string" ? searchParams?.sent : "";
  const failed = typeof searchParams?.failed === "string" ? searchParams?.failed : "";
  const sendCode = typeof searchParams?.send_code === "string" ? searchParams?.send_code : "";
  const errText = typeof searchParams?.error === "string" ? searchParams?.error : "";
  const replyStatus = typeof searchParams?.reply === "string" ? searchParams?.reply : "";
  const threadParam = typeof searchParams?.thread === "string" ? searchParams?.thread : "";

  if (!selectedCampaignId) {
    return (
      <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">No campaigns found in Supabase.</div>
        </div>
      </div>
    );
  }

  const selectedProspectsRes = await admin
    .from("prospects")
    .select("id,created_at,name,title,company,email,domain,status,last_email_sent,replied,meeting_booked,recent_activity")
    .eq("campaign_id", selectedCampaignId)
    .order("created_at", { ascending: false })
    .limit(250);
  const selectedProspects = (selectedProspectsRes.data || []) as any[];

  const ids = selectedProspects.map((p) => String(p.id || "")).filter(Boolean);
  const draftsRes =
    ids.length > 0
      ? await admin
          .from("email_drafts")
          .select("id,prospect_id,subject_lines,body,status,created_at,personalization_score,confidence_score")
          .in("prospect_id", ids)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(500)
      : ({ data: [], error: null } as any);
  const draftsByProspect: Record<string, any> = {};
  for (const d of (draftsRes.data || []) as any[]) {
    const pid = String(d.prospect_id || "").trim();
    if (!pid) continue;
    if (!draftsByProspect[pid]) draftsByProspect[pid] = d;
  }

  let latestReply: any | null = null;
  if (threadParam) {
    try {
      const mr = await admin
        .from("inbox_messages")
        .select("id,from_email,to_email,subject,intent,ai_confidence,ai_summary,ai_next_action,ai_draft_subject,ai_draft_body,escalated,knowledge_refs,created_at,thread_external_id")
        .eq("thread_external_id", threadParam)
        .order("created_at", { ascending: false })
        .limit(1);
      latestReply = ((mr.data || []) as any[])[0] || null;
    } catch {}
  }

  const steps = [
    { key: "upload", label: "1 Upload CSV" },
    { key: "enrich", label: "2 Enrich" },
    { key: "generate", label: "3 Generate" },
    { key: "review", label: "4 Review" },
    { key: "send", label: "5 Send" },
    { key: "replies", label: "6 Replies" },
  ];

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Guided Workflow</div>
              <div className="mt-1 text-sm text-slate-600">What happened, what’s happening, and what happens next.</div>
            </div>
            <form method="get" className="flex items-center gap-2">
              <select name="campaign" defaultValue={selectedCampaignId} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                {campaigns.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.name || "Campaign")}
                  </option>
                ))}
              </select>
              <input type="hidden" name="step" value={effectiveStep} />
              <button type="submit" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Load
              </button>
            </form>
          </div>

          {(imported || skipped || enriched || drafted || sent || failed || sendCode || errText) && (
            <div className={`mt-4 rounded-xl border p-3 text-sm ${failed ? "border-rose-200 bg-rose-50 text-rose-900" : "border-green-200 bg-green-50 text-green-900"}`}>
              <div className="font-semibold">Output</div>
              <div className="mt-1">
                {imported ? `Imported ${imported}. ` : ""}
                {skipped ? `Skipped duplicates ${skipped}. ` : ""}
                {enriched ? `Enriched ${enriched}. ` : ""}
                {drafted ? `Drafts generated ${drafted}. ` : ""}
                {sent ? `Sent ${sent}. ` : ""}
                {failed ? `Failed ${failed}. ` : ""}
                {sendCode ? `Last send error: ${sendCode}. ` : ""}
                {errText ? `Last error: ${errText}. ` : ""}
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-6">
            {steps.map((s) => (
              <a
                key={s.key}
                href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=${encodeURIComponent(s.key)}`}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                  effectiveStep === s.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {s.label} <span>→</span>
              </a>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {effectiveStep === "upload" && (
              <div>
                <div className="text-sm font-semibold text-slate-900">1) Upload CSV</div>
                <div className="mt-1 text-xs text-slate-600">Upload once. Rows appear below.</div>
                <form method="post" encType="multipart/form-data" action={`/api/campaigns/${encodeURIComponent(selectedCampaignId)}/import`} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input type="file" name="file" accept=".csv,text/csv" className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm" required />
                  <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                    Upload CSV
                  </button>
                </form>
                <div className="mt-3">
                  <a href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=enrich`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Next <span>→</span>
                  </a>
                </div>
              </div>
            )}

            {effectiveStep === "enrich" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">2) Enrich</div>
                  <div className="mt-1 text-xs text-slate-600">Adds domain intel per prospect.</div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={enrichCampaign}>
                    <input type="hidden" name="campaign_id" value={selectedCampaignId} />
                    <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                      Enrich Now
                    </button>
                  </form>
                  <a href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=generate`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Next <span>→</span>
                  </a>
                </div>
              </div>
            )}

            {effectiveStep === "generate" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">3) Generate personalized emails</div>
                  <div className="mt-1 text-xs text-slate-600">Creates a draft per prospect for review.</div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={generateDrafts}>
                    <input type="hidden" name="campaign_id" value={selectedCampaignId} />
                    <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                      Generate Drafts
                    </button>
                  </form>
                  <a href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=review`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Next <span>→</span>
                  </a>
                </div>
              </div>
            )}

            {effectiveStep === "review" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">4) Review generated emails</div>
                  <div className="mt-1 text-xs text-slate-600">Open each row’s draft to review subject/body.</div>
                </div>
                <a href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=send`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Next <span>→</span>
                </a>
              </div>
            )}

            {effectiveStep === "send" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">5) Send selected / Send all</div>
                  <div className="mt-1 text-xs text-slate-600">Select rows below and send.</div>
                </div>
                <a href={`/dashboard/hunting?campaign=${encodeURIComponent(selectedCampaignId)}&step=replies`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Next <span>→</span>
                </a>
              </div>
            )}

            {effectiveStep === "replies" && (
              <div>
                <div className="text-sm font-semibold text-slate-900">6) View AI-assisted replies</div>
                <div className="mt-1 text-xs text-slate-600">Paste a reply to generate a grounded response.</div>

                {replyStatus === "sent" && <div className="mt-3 text-xs text-green-700">Reply drafted and sent.</div>}
                {replyStatus === "ok" && <div className="mt-3 text-xs text-green-700">Reply drafted.</div>}
                {replyStatus === "no_prospect" && <div className="mt-3 text-xs text-rose-700">Could not map the reply sender to a prospect email.</div>}
                {replyStatus === "send_failed" && <div className="mt-3 text-xs text-rose-700">Reply drafted but sending failed.</div>}
                {replyStatus === "missing_openai" && <div className="mt-3 text-xs text-rose-700">Missing OPENAI_API_KEY.</div>}
                {replyStatus === "failed" && <div className="mt-3 text-xs text-rose-700">Reply analysis failed.</div>}
                {replyStatus === "invalid" && <div className="mt-3 text-xs text-rose-700">Fill from_email, to_email, and body.</div>}

                <form action={analyzeInboundReply} className="mt-3 grid grid-cols-1 gap-2" id="reply">
                  <input type="hidden" name="campaign_id" value={selectedCampaignId} />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input name="from_email" defaultValue={String(selectedProspects?.[0]?.email || "")} placeholder="From (client email)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900" />
                    <input name="to_email" defaultValue={String(process.env.DEFAULT_FROM_EMAIL || "")} placeholder="To (your sending inbox)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900" />
                  </div>
                  <input name="subject" placeholder="Subject (optional)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900" />
                  <textarea name="body" placeholder="Paste reply body…" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900" rows={5} />
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input name="auto_send" type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                    Auto-send reply now
                  </label>
                  <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                    Analyze Reply
                  </button>
                </form>

                {latestReply?.ai_draft_body && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-800">{String(latestReply.ai_draft_subject || "Draft reply")}</div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{String(latestReply.ai_draft_body)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
            <form action={sendDrafts}>
              <input type="hidden" name="campaign_id" value={selectedCampaignId} />
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2 text-left">Select</th>
                    <th className="p-2 text-left">Prospect</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Draft</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProspects.length === 0 ? (
                    <tr>
                      <td className="p-3 text-slate-600" colSpan={5}>
                        No prospects yet. Upload the CSV in step 1.
                      </td>
                    </tr>
                  ) : (
                    selectedProspects.map((p) => {
                      const pid = String(p.id || "");
                      const d = draftsByProspect[pid] || null;
                      const subj = d ? String((d.subject_lines || [])[0] || "").trim() : "";
                      const body = d ? String(d.body || "").trim() : "";
                      const preview = body ? body.replace(/\s+/g, " ").slice(0, 140) + (body.length > 140 ? "…" : "") : "No draft yet";
                      return (
                        <tr key={pid} className="border-t border-slate-100">
                          <td className="p-2">
                            <input name="prospect_id" value={pid} type="checkbox" className="h-4 w-4" />
                          </td>
                          <td className="p-2">{String(p.name || p.company || "—")}</td>
                          <td className="p-2">{String(p.email || "—")}</td>
                          <td className="p-2">{String(p.status || "—")}</td>
                          <td className="p-2">
                            <details>
                              <summary className="cursor-pointer text-sm text-slate-900">{subj || "Open draft"}</summary>
                              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{body || preview}</div>
                            </details>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {effectiveStep === "send" && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-3">
                  <div className="text-xs text-slate-600">Select prospects above, then send selected or send all.</div>
                  <div className="flex items-center gap-2">
                    <button name="send_mode" value="selected" type="submit" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      Send Selected
                    </button>
                    <button name="send_mode" value="all" type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                      Send All
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
