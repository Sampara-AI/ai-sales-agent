import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import Groq from "groq-sdk";

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  const groqKey = process.env.GROQ_API_KEY as string | undefined;
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });
  if (!groqKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });
  const supabase = createRouteHandlerClient({ cookies });
  const groq = new Groq({ apiKey: groqKey });

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const id = String(params?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  let followups_sent = 0;
  let moved_to_nurture = 0;
  const details: Array<{ prospect_id: string; followup_number: number; status: string }> = [];

  try {
    const { data: userData } = await supabase.auth.getUser();
    const currentUser = userData.user;
    if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const cRes = await supabase
      .from("hunting_campaigns")
      .select("id,name,enable_followups,followup_days,max_followups,email_daily_limit,created_by")
      .eq("id", id)
      .single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    const c = cRes.data as CampaignRow;
    const pr = await supabase.from("profiles").select("role").eq("user_id", currentUser.id).single();
    const isAdmin = (pr.data as any)?.role === "admin";
    if (!isAdmin && (c as any).created_by && (c as any).created_by !== currentUser.id) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    if (!c.enable_followups) return NextResponse.json({ success: true, followups_sent: 0, prospects_moved_to_nurture: 0, details: [], message: "Follow-ups disabled" });

    const days = Array.isArray(c.followup_days) ? c.followup_days : [3, 7, 14];
    const max = Math.max(1, Number(c.max_followups || 3));
    const limit = Math.max(1, Number(c.email_daily_limit || 10));

    const nowIso = new Date().toISOString();
    let prospects: ProspectRow[] = [];
    try {
      const q = await supabase
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
      const q = await supabase
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

    for (const p of prospects) {
      const cnt = Math.max(0, Number(p.followup_count || 0));
      const number = cnt + 1;
      const last = p.last_email_sent || p.contacted_at || new Date().toISOString();
      const daysSince = Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 86400000));
      const origRes = await supabase
        .from("email_campaigns")
        .select("body,subject")
        .eq("prospect_id", p.id)
        .order("sent_at", { ascending: false })
        .limit(1);
      const orig = (origRes.data || [])[0] as { body?: string; subject?: string } | undefined;
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
        `Add NEW value each time.`;
      const user = JSON.stringify({ prospect: { id: p.id, name: p.name, title: p.title, company: p.company, industry: p.industry }, original_email_body: orig?.body || "", followup_number: number, days_since_contact: daysSince });
      let subject = `Quick follow-up for ${p.company || "you"}`;
      let body = "";
      try {
        const completion = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.3, max_tokens: 400 });
        const content = completion.choices?.[0]?.message?.content ?? "";
        const m = content.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            body = typeof parsed.body === "string" ? parsed.body : content;
            subject = typeof parsed.subject === "string" ? parsed.subject : subject;
          } catch {
            body = content;
          }
        } else {
          body = content;
        }
      } catch {}

      const fromName = process.env.DEFAULT_FROM_NAME || "Tuple AI";
      const fromEmail = process.env.DEFAULT_FROM_EMAIL || "founders@tupleai.co.in";
      const toEmailRes = await supabase.from("prospects").select("email").eq("id", p.id).single();
      const toEmail = (toEmailRes.data as any)?.email || "";
      if (!toEmail) { details.push({ prospect_id: p.id, followup_number: number, status: "no_email" }); continue; }

      try {
        const sendRes = await fetch(`${baseUrl}/api/send-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: p.id, to_email: toEmail, subject, body, from_name: fromName, from_email: fromEmail }) });
        if (!sendRes.ok) { details.push({ prospect_id: p.id, followup_number: number, status: "failed" }); continue; }
        followups_sent += 1;
        const nextGap = number === 1 ? (days[1] || 7) : number === 2 ? (days[2] || 14) : null;
        const nextFollow = nextGap ? new Date(Date.now() + nextGap * 86400000).toISOString() : null;
        const upd = await supabase
          .from("prospects")
          .update({ followup_count: number, contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString(), next_followup_date: nextFollow || null, status: number >= max ? "nurture" : "contacted" })
          .eq("id", p.id);
        if (number >= max) moved_to_nurture += 1;
        details.push({ prospect_id: p.id, followup_number: number, status: number >= max ? "nurture" : "sent" });
      } catch {
        details.push({ prospect_id: p.id, followup_number: number, status: "failed" });
      }
    }

    const summary = `followups_sent=${followups_sent}; nurtured=${moved_to_nurture}`;
    await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "followup", result_summary: summary, status: "success" });
    return NextResponse.json({ success: true, followups_sent, prospects_moved_to_nurture: moved_to_nurture, details });
  } catch (err: any) {
    try {
      const summary = String(err?.message || "Follow-up failed");
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "followup", result_summary: summary, status: "error" });
    } catch {}
    return NextResponse.json({ success: false, error: err?.message || "Follow-up failed" }, { status: 500 });
  }
}