import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { claimJobs, markJobFailure, markJobSuccess, type JobRow } from "@/lib/server/job-queue";
import { createAdminClient } from "@/lib/server/supabase-admin";

function getBaseUrl(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function isInternalRequest(req: NextRequest) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (demoMode) return true;
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
  return !!internalSecret && internalHeader === internalSecret;
}

async function runSendEmail(job: JobRow, baseUrl: string) {
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const res = await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
    body: JSON.stringify({ ...(job.payload || {}), run_now: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error || "send-email failed"));
  return json;
}

async function runDomainEnrich(job: JobRow, baseUrl: string) {
  const prospectId = String(job.payload?.prospect_id || job.payload?.id || "").trim();
  if (!prospectId) throw new Error("missing prospect_id");
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const res = await fetch(`${baseUrl}/api/prospects/${prospectId}/enrich-domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
    body: JSON.stringify({ run_now: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error || "enrich-domain failed"));
  return json;
}

async function runGenerateOutreach(job: JobRow, baseUrl: string) {
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const res = await fetch(`${baseUrl}/api/generate-outreach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(internalSecret ? { "x-internal-secret": internalSecret } : {}) },
    body: JSON.stringify({ ...(job.payload || {}), enqueue_only: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error || "generate-outreach failed"));
  return json;
}

async function runSendFollowup(job: JobRow, baseUrl: string) {
  const admin = createAdminClient();
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) throw new Error("Missing GROQ_API_KEY");

  const prospectId = String(job.payload?.prospect_id || "").trim();
  const campaignId = String(job.payload?.campaign_id || "").trim();
  if (!prospectId || !campaignId) throw new Error("missing prospect_id or campaign_id");

  const pRes = await admin
    .from("prospects")
    .select("id,name,title,company,industry,email,contacted_at,last_email_sent,followup_count,replied,meeting_booked,status")
    .eq("id", prospectId)
    .single();
  if (pRes.error || !pRes.data) throw new Error("prospect not found");
  const p: any = pRes.data;
  if (!p.email) throw new Error("prospect has no email");
  if (p.replied) throw new Error("prospect already replied");
  if (p.meeting_booked) throw new Error("prospect meeting already booked");
  if (String(p.status || "") !== "contacted") throw new Error("prospect not in contacted status");

  const cRes = await admin.from("hunting_campaigns").select("id,followup_days,max_followups").eq("id", campaignId).single();
  if (cRes.error || !cRes.data) throw new Error("campaign not found");
  const c: any = cRes.data;
  const days = Array.isArray(c.followup_days) ? c.followup_days : [3, 7, 14];
  const max = Math.max(1, Number(c.max_followups || 3));

  const cnt = Math.max(0, Number(p.followup_count || 0));
  const number = cnt + 1;
  if (number > max) throw new Error("max followups reached");

  const lastIso = String(p.last_email_sent || p.contacted_at || "").trim();
  const last = lastIso ? new Date(lastIso) : new Date();
  const daysSince = Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000));

  const origRes = await admin
    .from("email_campaigns")
    .select("body,subject")
    .eq("prospect_id", prospectId)
    .order("sent_at", { ascending: false })
    .limit(1);
  const orig = (origRes.data || [])[0] as any;

  const system =
    `Generate follow-up email #${number} for B2B prospect.\n\n` +
    `Original email sent ${daysSince} days ago.\n` +
    `Prospect: ${p.name}, ${p.title || ""} at ${p.company || ""}\n` +
    `Industry: ${p.industry || ""}\n` +
    `Original pain points discussed: ${(orig?.subject || "").slice(0, 120)}\n\n` +
    `Follow-up strategy based on number:\n` +
    `- #1 (3 days): Gentle bump, add one new insight\n` +
    `- #2 (7 days): Share relevant case study or resource\n` +
    `- #3 (14 days): Final check-in, graceful close\n\n` +
    `Tone: Helpful consultant, not pushy salesperson.\n` +
    `Length: 60-80 words.\n\n` +
    `DO NOT repeat previous email content.\n` +
    `Add NEW value each time.\n\n` +
    `Return JSON only: { subject: string, body: string }`;
  const user = JSON.stringify({
    prospect: { id: p.id, name: p.name, title: p.title, company: p.company, industry: p.industry },
    original_email_body: orig?.body || "",
    followup_number: number,
    days_since_contact: daysSince,
  });

  const groq = new Groq({ apiKey: groqKey });
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: 400,
  });

  const content = completion.choices?.[0]?.message?.content ?? "";
  let subject = `Quick follow-up for ${p.company || "you"}`;
  let body = content;
  const m = content.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (typeof parsed?.subject === "string") subject = parsed.subject;
      if (typeof parsed?.body === "string") body = parsed.body;
    } catch {}
  }

  const fromName = process.env.DEFAULT_FROM_NAME || "vPersonalize Team";
  const fromEmail = process.env.DEFAULT_FROM_EMAIL || "hello@tupleai.co.in";
  await runSendEmail({ ...job, payload: { prospect_id: prospectId, to_email: p.email, subject, body, from_name: fromName, from_email: fromEmail } } as JobRow, baseUrl);

  const nextGap = number === 1 ? (days[1] || 7) : number === 2 ? (days[2] || 14) : null;
  const nextFollow = nextGap ? new Date(Date.now() + nextGap * 86400000).toISOString() : null;
  await admin
    .from("prospects")
    .update({ followup_count: number, contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString(), next_followup_date: nextFollow || null, status: number >= max ? "nurture" : "contacted" })
    .eq("id", prospectId);

  return { prospect_id: prospectId, followup_number: number, status: number >= max ? "nurture" : "sent" };
}

async function executeJob(job: JobRow, baseUrl: string) {
  if (job.type === "send_email") return await runSendEmail(job, baseUrl);
  if (job.type === "domain_enrich") return await runDomainEnrich(job, baseUrl);
  if (job.type === "generate_outreach") return await runGenerateOutreach(job, baseUrl);
  if (job.type === "send_followup") return await runSendFollowup(job, baseUrl);
  if (job.type === "gmail_sync") return { skipped: true };
  throw new Error(`Unknown job type: ${String(job.type)}`);
}

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const requestId = crypto.randomUUID();
  const baseUrl = getBaseUrl(req);
  const lockId = `worker:${requestId}`;
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(50, Number(body?.limit || 20)));

  const startedAt = Date.now();
  const jobs = await claimJobs(lockId, limit);
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const job of jobs) {
    try {
      await executeJob(job, baseUrl);
      await markJobSuccess(job.id);
      succeeded += 1;
      console.log(JSON.stringify({ level: "info", request_id: requestId, event: "job_succeeded", job_id: job.id, job_type: job.type }));
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "job failed";
      const res = await markJobFailure(job, msg);
      failed += 1;
      if (res.status === "dead") dead += 1;
      console.log(JSON.stringify({ level: "error", request_id: requestId, event: "job_failed", job_id: job.id, job_type: job.type, error: msg, attempts: res.attempts, status: res.status }));
    }
  }

  return NextResponse.json({
    success: true,
    request_id: requestId,
    claimed: jobs.length,
    succeeded,
    failed,
    dead,
    duration_ms: Date.now() - startedAt,
  });
}
