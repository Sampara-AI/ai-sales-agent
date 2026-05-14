import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { enqueueJobs } from "@/lib/server/job-queue";

type CampaignRow = {
  id: string;
  name: string;
  enable_followups?: boolean | null;
  followup_days?: number[] | null;
  max_followups?: number | null;
  email_daily_limit?: number | null;
};

type ProspectRow = {
  id: string;
  name: string;
  title?: string | null;
  company?: string | null;
  industry?: string | null;
  contacted_at?: string | null;
  last_email_sent?: string | null;
  next_followup_date?: string | null;
  followup_count?: number | null;
  ai_score?: number | null;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionClient = createRouteHandlerClient({ cookies });
  const adminDb = createAdminClient();

  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  try {
    const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
    const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
    const isInternal = !!internalSecret && internalHeader === internalSecret;

    let currentUserId: string | null = null;
    let isAdmin = false;
    if (!isInternal) {
      const { data: userData } = await sessionClient.auth.getUser();
      const currentUser = userData.user;
      if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      currentUserId = currentUser.id;
      const pr = await sessionClient.from("profiles").select("role").eq("user_id", currentUser.id).single();
      isAdmin = (pr.data as any)?.role === "admin";
    }

    const cRes = await adminDb
      .from("hunting_campaigns")
      .select("id,name,enable_followups,followup_days,max_followups,email_daily_limit,created_by")
      .eq("id", id)
      .single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    const c = cRes.data as CampaignRow;
    if (!isInternal && !isAdmin && (c as any).created_by && (c as any).created_by !== currentUserId) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    if (!c.enable_followups) return NextResponse.json({ success: true, followups_sent: 0, prospects_moved_to_nurture: 0, details: [], message: "Follow-ups disabled" });

    const days = Array.isArray(c.followup_days) ? c.followup_days : [3, 7, 14];
    const max = Math.max(1, Number(c.max_followups || 3));
    const limit = Math.max(1, Number(c.email_daily_limit || 10));

    const nowIso = new Date().toISOString();
    let prospects: ProspectRow[] = [];
    try {
      const q = await adminDb
        .from("prospects")
        .select("id,name,title,company,industry,contacted_at,last_email_sent,next_followup_date,followup_count,ai_score")
        .eq("campaign_id", id)
        .eq("status", "contacted")
        .eq("replied", false)
        .eq("meeting_booked", false)
        .lte("next_followup_date", nowIso)
        .lt("followup_count", max)
        .order("ai_score", { ascending: false })
        .limit(limit);
      prospects = (q.data || []) as ProspectRow[];
    } catch {
      const q = await adminDb
        .from("prospects")
        .select("id,name,title,company,industry,contacted_at,last_email_sent,followup_count,ai_score")
        .eq("campaign_id", id)
        .eq("status", "contacted")
        .eq("replied", false)
        .eq("meeting_booked", false)
        .order("ai_score", { ascending: false })
        .limit(limit);
      prospects = (q.data || []) as ProspectRow[];
      prospects = prospects.filter((p) => {
        const cnt = Number(p.followup_count || 0);
        if (cnt >= max) return false;
        const last = p.last_email_sent || p.contacted_at;
        if (!last) return false;
        const daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
        const nextGap = cnt === 0 ? days[0] : cnt === 1 ? days[1] : days[2] || 14;
        return daysSince >= nextGap;
      });
    }

    const throttleMs = Math.max(5_000, Math.min(600_000, Number(process.env.FOLLOWUP_THROTTLE_MS || 60_000)));
    const now = Date.now();
    const jobs = prospects.map((p, idx) => ({
      type: "send_followup" as const,
      payload: { prospect_id: p.id, campaign_id: id },
      priority: 110,
      runAfter: new Date(now + idx * throttleMs),
    }));

    let enqueued = 0;
    try {
      const res = await enqueueJobs(jobs);
      enqueued = res.inserted;
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message || "Failed to enqueue follow-up jobs" }, { status: 500 });
    }

    const summary = `jobs_enqueued=${enqueued}`;
    await adminDb.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "followup", result_summary: summary, status: "success" });
    return NextResponse.json({ success: true, campaign_id: id, jobs_enqueued: enqueued }, { status: 202 });
  } catch (err: any) {
    try {
      const summary = String(err?.message || "Follow-up failed");
      await adminDb.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "followup", result_summary: summary, status: "error" });
    } catch {}
    return NextResponse.json({ success: false, error: err?.message || "Follow-up failed" }, { status: 500 });
  }
}
