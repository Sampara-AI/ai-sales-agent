import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

type SendBody = {
  prospect_id: string;
  email_draft_id?: string;
  to_email: string;
  subject: string;
  body: string;
  from_name: string;
  from_email: string;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ success: false, error: "Missing RESEND_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as SendBody;
    const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
    if (!body?.prospect_id || !body?.to_email || !body?.subject || !body?.body || !body?.from_name || !body?.from_email) return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
    if (!emailRegex.test(body.to_email) || !emailRegex.test(body.from_email)) return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const prospectRes = await supabase.from("prospects").select("id, replied, contacted_at, last_email_sent").eq("id", body.prospect_id).single();
    if (prospectRes.error) return NextResponse.json({ success: false, error: "Prospect not found" }, { status: 404 });
    const p = prospectRes.data as { replied?: boolean | null; contacted_at?: string | null; last_email_sent?: string | null };
    if (p?.replied) return NextResponse.json({ success: false, error: "Prospect has replied, check your inbox" }, { status: 400 });
    const last = p?.last_email_sent || p?.contacted_at;
    if (last) {
      const threeDaysMs = 1000 * 60 * 60 * 24 * 3;
      if (Date.now() - new Date(last).getTime() < threeDaysMs) return NextResponse.json({ success: false, error: "Prospect was recently contacted" }, { status: 429 });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const sentTodayRes = await supabase
      .from("email_campaigns")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", start.toISOString());
    const sentToday = sentTodayRes.count || 0;
    if (sentToday >= 100) return NextResponse.json({ success: false, error: "Daily email limit reached. Upgrade Resend or try tomorrow." }, { status: 429 });

    const html = `
      <div style="background:#0b0b0b;color:#ededed;font-family:Inter,Arial,sans-serif;padding:24px">
        <div style="max-width:640px;margin:0 auto;background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:12px">
          <div style="padding:24px">
            <div style="font-size:14px;line-height:22px;white-space:pre-line">${body.body}</div>
            <div style="margin-top:24px;border-top:1px solid rgba(255,255,255,0.1)"></div>
            <div style="margin-top:16px;font-size:13px;line-height:20px">
              <div>Best regards,</div>
              <div>${body.from_name}</div>
              <div>AI Architect | 6 Patents in Enterprise AI</div>
              <div>Tuple AI</div>
              <div style="margin-top:8px"><a href="https://cal.com/tuple-ai/intro" style="color:#60a5fa;text-decoration:none">Book a 15-minute call</a></div>
            </div>
            <div style="margin-top:24px;font-size:12px;color:#9ca3af">
              <div><a href="https://tuple.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></div>
              <div style="margin-top:8px">Powered by Tuple AI</div>
            </div>
          </div>
        </div>
      </div>`;

    const text = `${body.body}\n\nBest regards,\n${body.from_name}\nAI Architect | 6 Patents in Enterprise AI\nTuple AI\n\nBook a 15-minute call: https://cal.com/tuple-ai/intro\nUnsubscribe: https://tuple.ai/unsubscribe`;

    const resend = new Resend(apiKey);
    const sendRes = await resend.emails.send({
      from: `${body.from_name} <${body.from_email}>`,
      to: body.to_email,
      subject: body.subject,
      html,
      text,
      tags: [{ name: "prospect_id", value: body.prospect_id }, ...(body.email_draft_id ? [{ name: "email_draft_id", value: body.email_draft_id }] : [])],
    });
    if ((sendRes as any)?.error) {
      const errMsg = (sendRes as any).error?.message || "Send failed";
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 });
    }

    await supabase
      .from("prospects")
      .update({ status: "contacted", contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString() })
      .eq("id", body.prospect_id);

    await supabase.from("email_campaigns").insert({
      prospect_id: body.prospect_id,
      email_draft_id: body.email_draft_id || null,
      subject: body.subject,
      body: body.body,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    if (body.email_draft_id) {
      await supabase.from("email_drafts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", body.email_draft_id);
    }

    return NextResponse.json({ success: true, message_id: (sendRes as any)?.id || "", message: "Email sent!" });
  } catch (err: any) {
    console.error("send-email error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Send failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}