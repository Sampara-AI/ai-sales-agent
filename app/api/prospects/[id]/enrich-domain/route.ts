import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import Groq from "groq-sdk";
import { enqueueJob } from "@/lib/server/job-queue";

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 180) : "";
}

function extractMetaDescription(html: string) {
  const m =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  return m ? String(m[1]).trim().slice(0, 280) : "";
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function deriveDomainFromEmail(email?: string | null) {
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at === -1) return "";
  return e.slice(at + 1).replace(/^www\./, "").toLowerCase();
}

function normalizeDomain(domain: string) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const prospectId = String((await params)?.id || "").trim();
  if (!prospectId) return NextResponse.json({ success: false, error: "Invalid prospect id" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  const groqKey = process.env.GROQ_API_KEY as string | undefined;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);
  const body = await req.json().catch(() => ({} as any));
  const runNow = Boolean((body as any)?.run_now);
  const enqueueOnly = (body as any)?.enqueue_only === false ? false : true;
  if (runNow && !isInternal) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    if (!isInternal) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      const currentUser = userData.user;
      if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

      const pr = await sessionClient.from("profiles").select("role").eq("user_id", currentUser.id).single();
      const isAdmin = (pr.data as any)?.role === "admin";
      if (!isAdmin) {
        const pRes = await sessionClient.from("prospects").select("id,campaign_id").eq("id", prospectId).single();
        if (pRes.error || !pRes.data) return NextResponse.json({ success: false, error: "Prospect not found" }, { status: 404 });
      }
    }

    if (!runNow && enqueueOnly) {
      const jobId = await enqueueJob("domain_enrich", { prospect_id: prospectId }, { priority: 120, runAfter: new Date() });
      return NextResponse.json({ success: true, queued: true, job_id: jobId, prospect_id: prospectId }, { status: 202 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const pRes = await admin.from("prospects").select("id,email,domain,company,recent_activity").eq("id", prospectId).single();
    if (pRes.error || !pRes.data) return NextResponse.json({ success: false, error: "Prospect not found" }, { status: 404 });
    const p = pRes.data as any;
    const domain = normalizeDomain(String(p.domain || "")) || deriveDomainFromEmail(p.email);
    if (!domain) return NextResponse.json({ success: false, error: "Prospect missing email domain" }, { status: 400 });

    let html = "";
    const candidates = [`https://${domain}`, `http://${domain}`];
    for (const u of candidates) {
      try {
        const res = await fetchWithTimeout(u, 8000);
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml\+xml/i.test(ct)) continue;
        html = await res.text();
        if (html) break;
      } catch {}
    }

    const title = html ? extractTitle(html) : "";
    const description = html ? extractMetaDescription(html) : "";
    const pageText = html ? stripTags(html).slice(0, 4000) : "";

    if (!title && !description && !pageText) {
      const intel = `Domain: ${domain}\nNote: No accessible HTML content fetched (blocked, non-HTML, or timeout).`;
      const nextRecent = [String(p.recent_activity || "").trim(), `Domain intel:\n${intel}`].filter(Boolean).join("\n\n");
      await admin.from("prospects").update({ recent_activity: nextRecent, status: "researched" }).eq("id", prospectId);
      return NextResponse.json({ success: true, prospect_id: prospectId, domain, title: "", description: "", company_summary: "", personalization_hooks: [] });
    }

    if (!groqKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });
    const groq = new Groq({ apiKey: groqKey });
    const system =
      "You are a GTM research assistant. Use only provided domain evidence (title, meta description, page text). If evidence is weak, say so. Return JSON only: " +
      '{ company_summary: string, personalization_hooks: string[] }. ' +
      "company_summary must be 2-3 sentences max. personalization_hooks must be 3-5 short bullets. Do not invent facts.";
    const user = JSON.stringify({ domain, title, description, page_text: pageText });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 600,
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ success: false, error: "Model returned invalid JSON" }, { status: 502 });
    const parsed = JSON.parse(match[0]) as { company_summary?: string; personalization_hooks?: string[] };

    const summary = String(parsed.company_summary || "").trim();
    const hooks = Array.isArray(parsed.personalization_hooks) ? parsed.personalization_hooks.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : [];
    const intel = [
      `Domain: ${domain}`,
      title ? `Title: ${title}` : "",
      description ? `Description: ${description}` : "",
      summary ? `Summary: ${summary}` : "",
      hooks.length ? `Hooks:\n- ${hooks.join("\n- ")}` : "",
    ].filter(Boolean).join("\n");

    const nextRecent = [String(p.recent_activity || "").trim(), `Domain intel:\n${intel}`].filter(Boolean).join("\n\n");
    await admin.from("prospects").update({ recent_activity: nextRecent, status: "researched" }).eq("id", prospectId);

    return NextResponse.json({ success: true, prospect_id: prospectId, domain, title, description, company_summary: summary, personalization_hooks: hooks });
  } catch (err: any) {
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Domain enrichment failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
