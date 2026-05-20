import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: any;
};

function parseEmailAddress(input: string) {
  const s = String(input || "").trim();
  const m = s.match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim().toLowerCase();
  const first = s.split(/[,\s]+/).find(Boolean) || "";
  return first.replace(/[<>]/g, "").trim().toLowerCase();
}

function stripHtml(html: string) {
  const s = String(html || "");
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuoted(text: string) {
  const t = String(text || "");
  const lines = t.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const l = line.trimEnd();
    if (/^On .+wrote:$/i.test(l)) break;
    if (/^From:\s/i.test(l)) break;
    if (/^Sent:\s/i.test(l)) break;
    if (/^To:\s/i.test(l)) break;
    if (/^Subject:\s/i.test(l)) break;
    if (/^---+\s*Original Message\s*---+/i.test(l)) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!supabaseUrl || (!supabaseServiceKey && !supabaseAnonKey)) return NextResponse.json({ success: false }, { status: 500 });
    const body = (await req.json()) as ResendEvent;
    const supabase = createClient(supabaseUrl, supabaseServiceKey || (supabaseAnonKey as string));

    const tags = body?.data?.tags || [];
    const tagMap: Record<string, string> = {};
    for (const t of tags) tagMap[t.name] = t.value;
    const prospectId = tagMap["prospect_id"];
    const emailDraftId = tagMap["email_draft_id"];

    if (body.type === "email.received") {
      const resendKey = String(process.env.RESEND_API_KEY || "").trim();
      const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
      const eventEmailId = String(body?.data?.email_id || "").trim();
      if (resendKey && eventEmailId) {
        const resend = new Resend(resendKey);
        const received: any = await (resend as any).emails.receiving.get(eventEmailId);
        const receivedEmail: any = (received as any)?.data || received;
        const fromEmail = parseEmailAddress(String(receivedEmail?.from || ""));
        const toEmail = parseEmailAddress(String((receivedEmail?.to || [])?.[0] || ""));
        const subject = String(receivedEmail?.subject || "").trim();
        const headers = (receivedEmail?.headers && typeof receivedEmail.headers === "object") ? receivedEmail.headers : {};
        const inReplyTo = String((headers as any)["in-reply-to"] || (headers as any)["In-Reply-To"] || "").trim();
        const references = String((headers as any)["references"] || (headers as any)["References"] || "").trim();
        const threadExternalId = inReplyTo || references || String(body?.data?.message_id || receivedEmail?.message_id || eventEmailId).trim();
        const rawText = String(receivedEmail?.text || "").trim() || stripHtml(String(receivedEmail?.html || ""));
        const cleanBody = stripQuoted(rawText).slice(0, 8000);

        if (fromEmail) {
          try {
            const existing = await supabase.from("prospects").select("id").ilike("email", fromEmail).limit(1);
            const existingId = String(((existing.data || []) as any[])[0]?.id || "").trim();
            if (!existingId) {
              await supabase.from("prospects").insert({ email: fromEmail });
            }
          } catch {}
        }

        const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
        const forwardedProto = req.headers.get("x-forwarded-proto") || (forwardedHost.includes("localhost") ? "http" : "https");
        const baseUrl = `${forwardedProto}://${forwardedHost}`;

        const respondRes = await fetch(`${baseUrl}/api/inbox/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
          },
          body: JSON.stringify({
            mailbox: "resend",
            external_thread_id: threadExternalId || eventEmailId,
            from_email: fromEmail || "",
            to_email: toEmail || "",
            subject,
            body: cleanBody || rawText || "(no content)",
          }),
        });
        const respondJson: any = await respondRes.json().catch(() => ({}));
        const draftedSubject = String(respondJson?.response_subject || "").trim();
        const draftedBody = String(respondJson?.response_body || "").trim();

        const pRes = fromEmail ? await supabase.from("prospects").select("id").ilike("email", fromEmail).limit(1) : null;
        const pid = String(((pRes?.data || []) as any[])[0]?.id || "").trim() || String(respondJson?.thread?.prospect_id || "").trim();

        if (draftedBody && pid) {
          await fetch(`${baseUrl}/api/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
            },
            body: JSON.stringify({
              prospect_id: pid,
              to_email: fromEmail,
              subject: draftedSubject || (subject ? `Re: ${subject}` : "Re:"),
              body: draftedBody,
              allow_replied: true,
              run_now: true,
              enqueue_only: false,
            }),
          });
        }
      }

      return NextResponse.json({ success: true });
    }

    if (body.type === "email.opened") {
      if (prospectId) await supabase.from("email_campaigns").update({ opened_at: new Date().toISOString(), status: "opened" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
      await supabase.from("prospects").update({ email_opened: true }).eq("id", prospectId);
    } else if (body.type === "email.clicked") {
      if (prospectId) await supabase.from("email_campaigns").update({ clicked_at: new Date().toISOString(), status: "clicked" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
      await supabase.from("prospects").update({ email_clicked: true }).eq("id", prospectId);
    } else if (body.type === "email.bounced") {
      if (prospectId) await supabase.from("email_campaigns").update({ bounced: true, status: "bounced" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
    } else if (body.type === "email.replied") {
      if (prospectId) {
        await supabase.from("email_campaigns").update({ replied_at: new Date().toISOString(), status: "replied" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
        await supabase.from("prospects").update({ replied: true }).eq("id", prospectId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("resend webhook error", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
