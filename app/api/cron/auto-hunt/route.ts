import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Campaign = {
  id: string;
  name: string;
  status: string;
  send_weekends?: boolean | null;
  schedule_start?: string | null;
  last_run_at?: string | null;
  followup_days?: number[] | null;
};

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const now = new Date();
  const nowIso = now.toISOString();

  let campaigns_processed = 0;
  let hunts_run = 0;
  let email_batches_sent = 0;
  let followups_sent = 0;
  let total_prospects_found = 0;
  let total_emails_sent = 0;

  try {
    const q = await supabase
      .from("hunting_campaigns")
      .select("id,name,status,send_weekends,schedule_start,last_run_at,followup_days")
      .eq("status", "active")
      .or(`schedule_start.lte.${nowIso},schedule_start.is.null`)
      .order("schedule_start", { ascending: true });
    const campaigns = (q.data || []) as Campaign[];

    for (const c of campaigns) {
      campaigns_processed += 1;
      const isWeekend = now.getDay() === 0 || now.getDay() === 6;

      let shouldHunt = true;
      if (c.last_run_at) {
        const diff = now.getTime() - new Date(c.last_run_at).getTime();
        shouldHunt = diff >= 24 * 3600000;
      }
      if (shouldHunt) {
        try {
          const res = await fetch(`${baseUrl}/api/campaigns/${c.id}/hunt`, { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            hunts_run += 1;
            total_prospects_found += Number(data?.prospects_found || 0);
          }
        } catch {}
      }

      let readyCount = 0;
      try {
        const readyRes = await supabase
          .from("prospects")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id)
          .eq("status", "email_ready")
          .is("contacted_at", null);
        readyCount = readyRes.count || 0;
      } catch {}

      if (readyCount > 0 && (!isWeekend || c.send_weekends)) {
        try {
          const res = await fetch(`${baseUrl}/api/campaigns/${c.id}/send`, { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            email_batches_sent += 1;
            total_emails_sent += Number(data?.emails_sent || 0);
          }
        } catch {}
      }

      let followupDue = 0;
      try {
        const fRes = await supabase
          .from("prospects")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id)
          .eq("status", "contacted")
          .eq("replied", false)
          .eq("meeting_booked", false)
          .lte("next_followup_date", nowIso);
        followupDue = fRes.count || 0;
      } catch {
        try {
          const listRes = await supabase
            .from("prospects")
            .select("id,contacted_at,last_email_sent,followup_count")
            .eq("campaign_id", c.id)
            .eq("status", "contacted")
            .eq("replied", false)
            .eq("meeting_booked", false);
          const days = Array.isArray(c.followup_days) ? c.followup_days : [3, 7, 14];
          const items = (listRes.data || []) as { id: string; contacted_at?: string | null; last_email_sent?: string | null; followup_count?: number | null }[];
          followupDue = items.filter((p) => {
            const cnt = Number(p.followup_count || 0);
            const last = p.last_email_sent || p.contacted_at;
            if (!last) return false;
            const daysSince = Math.floor((now.getTime() - new Date(last).getTime()) / 86400000);
            const nextGap = cnt === 0 ? days[0] : cnt === 1 ? days[1] : days[2] || 14;
            return daysSince >= nextGap;
          }).length;
        } catch {}
      }

      if (followupDue > 0) {
        try {
          const res = await fetch(`${baseUrl}/api/campaigns/${c.id}/followup`, { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            followups_sent += Number(data?.followups_sent || 0);
          }
        } catch {}
      }

      const next = new Date(now.getTime() + 24 * 3600000).toISOString();
      await supabase.from("hunting_campaigns").update({ schedule_start: next }).eq("id", c.id);
    }

    return NextResponse.json({ campaigns_processed, hunts_run, email_batches_sent, followups_sent, total_prospects_found, total_emails_sent });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Auto-hunt failed" }, { status: 500 });
  }
}