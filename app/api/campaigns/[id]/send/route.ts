import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { enqueueJobs } from "@/lib/server/job-queue";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  email_daily_limit?: number | null;
  send_weekends?: boolean | null;
  followup_days?: number[] | null;
};

type ProspectRow = {
  id: string;
  email?: string | null;
  ai_score?: number | null;
};

type DraftRow = {
  id: string;
  prospect_id: string;
  subject_lines: string[] | null;
  body: string;
  status: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const adminDb = createAdminClient();
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html");

  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  try {
    const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
    const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
    const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);

    let currentUserId: string | null = null;
    let isAdmin = false;
    if (!isInternal) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      const currentUser = userData.user;
      if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      currentUserId = currentUser.id;
      const pr = await sessionClient.from("profiles").select("role").eq("user_id", currentUser.id).single();
      isAdmin = (pr.data as any)?.role === "admin";
    }

    const cRes = await adminDb
      .from("hunting_campaigns")
      .select("id,name,status,email_daily_limit,send_weekends,followup_days,created_by")
      .eq("id", id)
      .single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    const c = cRes.data as CampaignRow;
    if (!isInternal && !isAdmin && (c as any).created_by && (c as any).created_by !== currentUserId) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    if (String(c.status) !== "active") return NextResponse.json({ success: false, error: "Campaign not active" }, { status: 400 });

    const limit = Math.max(1, Number(c.email_daily_limit || 10));
    const sendWeekends = Boolean(c.send_weekends);
    const today = new Date();
    const dow = today.getDay();
    if (!sendWeekends && (dow === 0 || dow === 6)) {
      const next = new Date();
      const add = dow === 6 ? 2 : 1;
      next.setDate(next.getDate() + add);
      next.setHours(9, 0, 0, 0);
      if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?send=0&campaign=${encodeURIComponent(id)}`, req.url), 303);
      return NextResponse.json({ success: true, campaign_id: id, emails_sent: 0, emails_failed: 0, remaining_daily_limit: limit, next_eligible_send: next.toISOString(), message: "Weekend sending disabled" });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const pIdsRes = await adminDb.from("prospects").select("id").eq("campaign_id", id);
    const prospectIds = (pIdsRes.data || []).map((r: any) => r.id);
    let sentToday = 0;
    if (prospectIds.length > 0) {
      const sentTodayRes = await adminDb
        .from("email_campaigns")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", start.toISOString())
        .in("prospect_id", prospectIds);
      sentToday = sentTodayRes.count || 0;
    }
    const remaining = Math.max(0, limit - sentToday);
    if (remaining <= 0) {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?send=0&campaign=${encodeURIComponent(id)}`, req.url), 303);
      return NextResponse.json({ success: true, campaign_id: id, emails_sent: 0, emails_failed: 0, remaining_daily_limit: 0, next_eligible_send: next.toISOString(), message: "Daily limit reached" });
    }

    const readyRes = await adminDb
      .from("prospects")
      .select("id,email,ai_score")
      .eq("campaign_id", id)
      .eq("status", "email_ready")
      .is("contacted_at", null)
      .order("ai_score", { ascending: false, nullsFirst: false })
      .limit(remaining);
    const ready = (readyRes.data || []) as ProspectRow[];

    const ids = ready.map((p) => p.id);
    const draftsByProspect: Record<string, DraftRow> = {};
    if (ids.length > 0) {
      const draftsRes = await adminDb
        .from("email_drafts")
        .select("id,prospect_id,subject_lines,body,status,created_at")
        .in("prospect_id", ids)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(Math.min(500, ids.length * 5));
      for (const d of (draftsRes.data || []) as any[]) {
        const pid = String(d.prospect_id || "");
        if (!pid) continue;
        if (!draftsByProspect[pid]) draftsByProspect[pid] = d as DraftRow;
      }
    }

    const throttleMs = Math.max(5_000, Math.min(300_000, Number(process.env.EMAIL_THROTTLE_MS || 30_000)));
    const follow1 = Array.isArray(c.followup_days) && c.followup_days[0] ? Number(c.followup_days[0]) : 3;
    const now = Date.now();

    const fromName = process.env.DEFAULT_FROM_NAME || "Tuple AI";
    const fromEmail = process.env.DEFAULT_FROM_EMAIL || "founders@tupleai.co.in";
    const jobs = ready
      .map((p, idx) => {
        const email = String(p.email || "").trim();
        if (!email) return null;
        const draft = draftsByProspect[p.id];
        if (!draft || !draft.body) return null;
        const subject = (Array.isArray(draft.subject_lines) ? draft.subject_lines[0] : undefined) || `Quick note for ${email}`;
        const nextFollow = new Date(Date.now() + follow1 * 86400000).toISOString();
        return {
          type: "send_email" as const,
          payload: { prospect_id: p.id, email_draft_id: draft.id, to_email: email, subject, body: draft.body, from_name: fromName, from_email: fromEmail, next_followup_date: nextFollow },
          priority: 100,
          runAfter: new Date(now + idx * throttleMs),
        };
      })
      .filter(Boolean) as Array<{ type: "send_email"; payload: Record<string, any>; priority?: number; runAfter?: Date }>;

    let enqueued = 0;
    try {
      const res = await enqueueJobs(jobs);
      enqueued = res.inserted;
    } catch (e: any) {
      if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?send=failed&campaign=${encodeURIComponent(id)}`, req.url), 303);
      return NextResponse.json({ success: false, error: e?.message || "Failed to enqueue send jobs" }, { status: 500 });
    }

    await adminDb.from("hunting_campaigns").update({ last_run_at: new Date().toISOString() }).eq("id", id);
    const summary = `jobs_enqueued=${enqueued}; remaining_daily_limit=${remaining}`;
    await adminDb.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "email", result_summary: summary, status: "success" });

    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    const remaining_daily_limit = Math.max(0, limit - sentToday);
    if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?send=${enqueued}&campaign=${encodeURIComponent(id)}`, req.url), 303);
    return NextResponse.json({ success: true, campaign_id: id, jobs_enqueued: enqueued, remaining_daily_limit, next_eligible_send: next.toISOString() }, { status: 202 });
  } catch (err: any) {
    try {
      const summary = String(err?.message || "Send failed");
      await adminDb.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "email", result_summary: summary, status: "error" });
    } catch {}
    if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?send=failed&campaign=${encodeURIComponent(id)}`, req.url), 303);
    return NextResponse.json({ success: false, error: err?.message || "Email send failed" }, { status: 500 });
  }
}
