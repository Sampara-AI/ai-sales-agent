import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient({ cookies });

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const id = String(params?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  let runStatus: "success" | "partial" | "error" = "success";
  let emails_sent = 0;
  let emails_failed = 0;

  try {
    const { data: userData } = await supabase.auth.getUser();
    const currentUser = userData.user;
    if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const cRes = await supabase
      .from("hunting_campaigns")
      .select("id,name,status,email_daily_limit,send_weekends,followup_days,created_by")
      .eq("id", id)
      .single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    const c = cRes.data as CampaignRow;
    const pr = await supabase.from("profiles").select("role").eq("user_id", currentUser.id).single();
    const isAdmin = (pr.data as any)?.role === "admin";
    if (!isAdmin && (c as any).created_by && (c as any).created_by !== currentUser.id) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
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
      return NextResponse.json({ success: true, campaign_id: id, emails_sent: 0, emails_failed: 0, remaining_daily_limit: limit, next_eligible_send: next.toISOString(), message: "Weekend sending disabled" });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const pIdsRes = await supabase.from("prospects").select("id").eq("campaign_id", id);
    const prospectIds = (pIdsRes.data || []).map((r: any) => r.id);
    let sentToday = 0;
    if (prospectIds.length > 0) {
      const sentTodayRes = await supabase
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
      return NextResponse.json({ success: true, campaign_id: id, emails_sent: 0, emails_failed: 0, remaining_daily_limit: 0, next_eligible_send: next.toISOString(), message: "Daily limit reached" });
    }

    const readyRes = await supabase
      .from("prospects")
      .select("id,email,ai_score")
      .eq("campaign_id", id)
      .eq("status", "email_ready")
      .is("contacted_at", null)
      .order("ai_score", { ascending: false, nullsFirst: false })
      .limit(remaining);
    const ready = (readyRes.data || []) as ProspectRow[];

    for (const p of ready) {
      const email = (p.email || "").trim();
      if (!email) { emails_failed += 1; continue; }
      const draftsRes = await supabase
        .from("email_drafts")
        .select("id,prospect_id,subject_lines,body,status")
        .eq("prospect_id", p.id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1);
      const draft = ((draftsRes.data || []) as DraftRow[])[0];
      if (!draft) { emails_failed += 1; continue; }
      const subject = (Array.isArray(draft.subject_lines) ? draft.subject_lines[0] : undefined) || `Quick note for ${email}`;
      const fromName = process.env.DEFAULT_FROM_NAME || "Tuple AI";
      const fromEmail = process.env.DEFAULT_FROM_EMAIL || "founders@tupleai.co.in";
      try {
        const sendRes = await fetch(`${baseUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospect_id: p.id, email_draft_id: draft.id, to_email: email, subject, body: draft.body, from_name: fromName, from_email: fromEmail }),
        });
        if (!sendRes.ok) { emails_failed += 1; continue; }
        emails_sent += 1;
        const follow1 = Array.isArray(c.followup_days) && c.followup_days[0] ? Number(c.followup_days[0]) : 3;
        const nextFollow = new Date();
        nextFollow.setDate(nextFollow.getDate() + follow1);
        const upd = await supabase
          .from("prospects")
          .update({ status: "contacted", contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString(), next_followup_date: nextFollow.toISOString() })
          .eq("id", p.id);
        if (upd.error && /column .* next_followup_date/i.test(upd.error.message || "")) {
          await supabase
            .from("prospects")
            .update({ status: "contacted", contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString() })
            .eq("id", p.id);
        }
      } catch (e) {
        emails_failed += 1;
      }
    }

    const campUpd = await supabase
      .from("hunting_campaigns")
      .update({ contacted_count: (c as any).contacted_count ? Number((c as any).contacted_count) + emails_sent : emails_sent, last_run_at: new Date().toISOString() })
      .eq("id", id);
    if (campUpd.error) runStatus = "partial";

    const summary = `emails_sent=${emails_sent}; emails_failed=${emails_failed}`;
    await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "email", result_summary: summary, status: runStatus });

    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    const remaining_daily_limit = Math.max(0, limit - (sentToday + emails_sent));
    return NextResponse.json({ success: true, campaign_id: id, emails_sent, emails_failed, remaining_daily_limit, next_eligible_send: next.toISOString() });
  } catch (err: any) {
    try {
      const summary = String(err?.message || "Send failed");
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "email", result_summary: summary, status: "error" });
    } catch {}
    return NextResponse.json({ success: false, error: err?.message || "Email send failed" }, { status: 500 });
  }
}