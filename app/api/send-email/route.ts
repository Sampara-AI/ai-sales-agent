import { NextResponse, NextRequest } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { enqueueJob } from "@/lib/server/job-queue";

type SendBody = {
  prospect_id: string;
  email_draft_id?: string;
  to_email?: string;
  to?: string;
  subject: string;
  body: string;
  from_name?: string;
  from_email?: string;
  enqueue_only?: boolean;
  run_now?: boolean;
  next_followup_date?: string | null;
  allow_replied?: boolean;
};

async function loadAiSettings(adminDb: any) {
  const sanitizeBrand = (value: any) => {
    const v = String(value || "").trim();
    if (!v) return v;
    return /sampara/i.test(v) ? "VPersonalize" : v;
  };
  const fallback = {
    brand_name: String(process.env.NEXT_PUBLIC_BRAND_NAME || process.env.DEFAULT_FROM_NAME || "VPersonalize").trim(),
    brand_website: String(process.env.EMAIL_BRAND_URL || process.env.NEXT_PUBLIC_BRAND_URL || "https://www.vpersonalize.com").trim(),
    cta_text: String(process.env.EMAIL_FOOTER_LINK_TEXT || "Book a quick 15-minute chat").trim(),
    cta_url: String(process.env.EMAIL_FOOTER_LINK_URL || "https://cal.com/vpersonalize/intro").trim(),
    sender_name: String(process.env.DEFAULT_FROM_NAME || "VPersonalize").trim(),
    sender_title: String(process.env.EMAIL_SIGNATURE_TITLE || "Partnerships").trim(),
    sender_company: String(process.env.EMAIL_SIGNATURE_COMPANY || "VPersonalize").trim(),
    credibility_line: String(process.env.EMAIL_CREDIBILITY_LINE || "").trim(),
  };
  try {
    const res = await adminDb.from("audit_events").select("meta").eq("action", "ai_settings").order("created_at", { ascending: false }).limit(1);
    const meta = ((res.data || []) as any[])[0]?.meta;
    if (!meta || typeof meta !== "object") return fallback;
    const merged = { ...fallback, ...meta };
    merged.brand_name = sanitizeBrand(merged.brand_name) || "VPersonalize";
    merged.sender_name = sanitizeBrand(merged.sender_name) || "VPersonalize";
    merged.sender_company = sanitizeBrand(merged.sender_company) || "VPersonalize";
    return merged;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  try {
    const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
    const apiKey = process.env.RESEND_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ success: false, error: "Missing RESEND_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseServiceKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as SendBody;
    const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
    const defaultFromEmail = process.env.DEFAULT_FROM_EMAIL || "founder@vpersonalize.com";
    const unsubscribeUrl = process.env.EMAIL_UNSUBSCRIBE_URL || "https://www.vpersonalize.com/unsubscribe";
    const toEmail = String(body?.to_email || body?.to || "").trim();
    if (!body?.prospect_id || !toEmail || !body?.subject || !body?.body) return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
    if (!emailRegex.test(toEmail)) return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });

    const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
    const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
    const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);
    const runNow = Boolean((body as any)?.run_now);
    const enqueueOnly = (body as any)?.enqueue_only === false ? false : true;
    if (runNow && !isInternal) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!isInternal) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      if (!userData.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const aiSettings = await loadAiSettings(supabase as any);
    const defaultFromName = String((aiSettings as any)?.sender_name || "VPersonalize").trim();
    const fromName = String(body.from_name || defaultFromName).trim();
    const fromEmail = String(body.from_email || defaultFromEmail).trim();
    if (!emailRegex.test(fromEmail)) return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });

    const footerLinkText = String((aiSettings as any)?.cta_text || process.env.EMAIL_FOOTER_LINK_TEXT || "Book a quick 15-minute chat").trim();
    const footerLinkUrl = String((aiSettings as any)?.cta_url || process.env.EMAIL_FOOTER_LINK_URL || "https://cal.com/vpersonalize/intro").trim();
    const brandUrl = String((aiSettings as any)?.brand_website || process.env.EMAIL_BRAND_URL || process.env.NEXT_PUBLIC_BRAND_URL || "https://www.vpersonalize.com").trim();
    const poweredByText = String(process.env.EMAIL_POWERED_BY_TEXT || `Powered by ${String((aiSettings as any)?.brand_name || "VPersonalize").trim()}`).trim();
    if (!runNow && enqueueOnly) {
      const jobPayload = {
        prospect_id: body.prospect_id,
        email_draft_id: body.email_draft_id || null,
        to_email: toEmail,
        subject: body.subject,
        body: body.body,
        from_name: fromName,
        from_email: fromEmail,
        next_followup_date: body.next_followup_date || null,
      };
      const jobId = await enqueueJob("send_email", jobPayload, { priority: 100, runAfter: new Date() });
      return NextResponse.json({ success: true, queued: true, job_id: jobId }, { status: 202 });
    }

    const allowReplied = Boolean((body as any)?.allow_replied);
    const prospectRes = await supabase.from("prospects").select("id, replied, contacted_at, last_email_sent").eq("id", body.prospect_id).single();
    if (prospectRes.error) return NextResponse.json({ success: false, error: "Prospect not found" }, { status: 404 });
    const p = prospectRes.data as { replied?: boolean | null; contacted_at?: string | null; last_email_sent?: string | null };
    if (p?.replied && !allowReplied) return NextResponse.json({ success: false, error: "Prospect has replied, check your inbox" }, { status: 400 });
    try {
      const sup = await supabase.from("email_suppressions").select("id,reason").ilike("email", toEmail).limit(1);
      if (!sup.error && (sup.data || []).length > 0) {
        const reason = String((sup.data as any)?.[0]?.reason || "suppressed");
        return NextResponse.json({ success: false, error: `Suppressed: ${reason}` }, { status: 400 });
      }
    } catch {}
    if (!demoMode) {
      const last = p?.last_email_sent || p?.contacted_at;
      if (last) {
        const threeDaysMs = 1000 * 60 * 60 * 24 * 3;
        if (Date.now() - new Date(last).getTime() < threeDaysMs) return NextResponse.json({ success: false, error: "Prospect was recently contacted" }, { status: 429 });
      }
    }

    if (!demoMode) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const sentTodayRes = await supabase
        .from("email_campaigns")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", start.toISOString());
      const sentToday = sentTodayRes.count || 0;
      if (sentToday >= 100) return NextResponse.json({ success: false, error: "Daily email limit reached. Upgrade Resend or try tomorrow." }, { status: 429 });
    }

    const sigTitle = String((aiSettings as any)?.sender_title || process.env.EMAIL_SIGNATURE_TITLE || "Partnerships").trim();
    const sigCompany = String((aiSettings as any)?.sender_company || process.env.EMAIL_SIGNATURE_COMPANY || "VPersonalize").trim();
    const sigCred = String((aiSettings as any)?.credibility_line || process.env.EMAIL_CREDIBILITY_LINE || "").trim();

    const html = `
      <div style="background:#0b0b0b;color:#ededed;font-family:Inter,Arial,sans-serif;padding:24px">
        <div style="max-width:640px;margin:0 auto;background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:12px">
          <div style="padding:24px">
            <div style="font-size:14px;line-height:22px;white-space:pre-line">${body.body}</div>
            <div style="margin-top:24px;border-top:1px solid rgba(255,255,255,0.1)"></div>
            <div style="margin-top:16px;font-size:13px;line-height:20px">
              <div>Best regards,</div>
              <div>${fromName}</div>
              <div>${sigTitle}</div>
              <div>${sigCompany}</div>
              ${sigCred ? `<div>${sigCred}</div>` : ""}
              <div style="margin-top:8px"><a href="${footerLinkUrl}" style="color:#60a5fa;text-decoration:none">${footerLinkText}</a></div>
            </div>
            <div style="margin-top:24px;font-size:12px;color:#9ca3af">
              <div><a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a></div>
              <div style="margin-top:8px"><a href="${brandUrl}" style="color:#9ca3af;text-decoration:underline">${poweredByText}</a></div>
            </div>
          </div>
        </div>
      </div>`;

    const text = `${body.body}\n\nBest regards,\n${fromName}\n${sigTitle}\n${sigCompany}${sigCred ? `\n${sigCred}` : ""}\n\n${footerLinkText}: ${footerLinkUrl}\nUnsubscribe: ${unsubscribeUrl}\n${poweredByText}: ${brandUrl}`;

    const resend = new Resend(apiKey);
    const replyToEmail = String(process.env.RESEND_REPLY_TO || "").trim();
    const sendRes = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toEmail,
      subject: body.subject,
      html,
      text,
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      tags: [{ name: "prospect_id", value: body.prospect_id }, ...(body.email_draft_id ? [{ name: "email_draft_id", value: body.email_draft_id }] : [])],
    });
    if ((sendRes as any)?.error) {
      const errMsg = (sendRes as any).error?.message || "Send failed";
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 });
    }

    const prospectUpdate: Record<string, any> = { status: "contacted", contacted_at: new Date().toISOString(), last_email_sent: new Date().toISOString() };
    if (body.next_followup_date) prospectUpdate.next_followup_date = body.next_followup_date;
    await supabase.from("prospects").update(prospectUpdate).eq("id", body.prospect_id);

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
