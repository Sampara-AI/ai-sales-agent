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

function sanitizeEnterpriseCopy(text: string) {
  const t = String(text || "");
  return t
    .replace(/sampara ai/gi, "VPersonalize")
    .replace(/not enough information( is| was)? available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/not enough information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/limited information available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/insufficient information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.");
}

function toHttpsUrl(domain: string, path = "") {
  const d = normalizeDomain(domain);
  if (!d) return "";
  const p = String(path || "").trim();
  if (!p) return `https://${d}`;
  const nextPath = p.startsWith("/") ? p : `/${p}`;
  return `https://${d}${nextPath}`;
}

function safeJsonExtract(text: string) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function cleanMarkdown(input: string) {
  const lines = String(input || "").split(/\r?\n/);
  const cleaned: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (
      lower.includes("cookie") ||
      lower.includes("privacy") ||
      lower.includes("terms") ||
      lower.includes("all rights reserved") ||
      lower.includes("©") ||
      lower.includes("subscribe") ||
      lower.includes("sign up") ||
      lower.includes("log in") ||
      lower.includes("login") ||
      lower.includes("contact us") ||
      lower.includes("careers") ||
      lower.includes("instagram") ||
      lower.includes("linkedin") ||
      lower.includes("facebook") ||
      lower.includes("twitter") ||
      lower.includes("x.com")
    ) {
      continue;
    }
    if (/^\[(home|about|products|pricing|blog|contact)\]\(/i.test(line)) continue;
    cleaned.push(raw);
    if (cleaned.join("\n").length > 9000) break;
  }
  return cleaned.join("\n").trim();
}

async function firecrawlScrapeMarkdown(url: string, apiKey: string) {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok || j?.success === false) {
    const msg = String(j?.error || j?.message || "Firecrawl scrape failed");
    throw new Error(msg);
  }
  const md = String(j?.data?.markdown || j?.markdown || "").trim();
  const title = String(j?.data?.metadata?.title || j?.data?.title || "").trim();
  const description = String(j?.data?.metadata?.description || j?.data?.metadata?.metaDescription || "").trim();
  return { markdown: md, title, description };
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

    if (!groqKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });
    const groq = new Groq({ apiKey: groqKey });

    const candidatePaths = [
      "",
      "/about",
      "/products",
      "/product",
      "/solutions",
      "/manufacturing",
      "/sustainability",
      "/team",
    ];
    const urls = candidatePaths.map((p) => toHttpsUrl(domain, p)).filter(Boolean);
    const firecrawlKey = String(process.env.FIRECRAWL_API_KEY || "").trim();
    const sources: Array<{ url: string; title: string; description: string; excerpt: string; content_type: string }> = [];
    for (const url of urls) {
      if (sources.length >= 4) break;
      try {
        if (firecrawlKey) {
          const fc = await firecrawlScrapeMarkdown(url, firecrawlKey);
          const excerpt = cleanMarkdown(fc.markdown).slice(0, 1800);
          if (!excerpt) continue;
          sources.push({ url, title: fc.title, description: fc.description, excerpt, content_type: "text/markdown" });
          continue;
        }
        const res = await fetchWithTimeout(url, 6500);
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml\+xml/i.test(ct)) continue;
        const html = await res.text();
        if (!html) continue;
        const title = extractTitle(html);
        const description = extractMetaDescription(html);
        const excerpt = stripTags(html).slice(0, 1800);
        sources.push({ url, title, description, excerpt, content_type: ct });
      } catch {}
    }

    const system =
      "You are an enterprise-grade manufacturing and GTM research assistant for vPersonalize.\n" +
      "You will receive multiple web sources (URLs + extracted excerpts). Use them to synthesize operationally-relevant intelligence.\n" +
      "Inference is allowed. Fabrication is prohibited.\n\n" +
      "Return JSON only with this schema:\n" +
      "{\n" +
      '  company_summary: string,\n' +
      '  sources_used: { url: string, note: string }[],\n' +
      '  key_points: string[],\n' +
      '  operational_signals: string[],\n' +
      '  inferred_friction: string[],\n' +
      '  matchmaking: { target: string, pain_points: string[], match_angle: string, core_hook: string },\n' +
      '  caveats: string[],\n' +
      "  confidence: number\n" +
      "}\n\n" +
      "Rules:\n" +
      "- confidence: 0-100\n" +
      "- key_points: 4-8 bullets (facts/observations from sources)\n" +
      "- operational_signals: 4-8 bullets (signals like scale, SKU complexity, customization workflows, sustainability pressure)\n" +
      "- inferred_friction: 3-6 bullets (commercially reasonable inferences, not invented facts)\n" +
      '- caveats: if sources are thin/unavailable, include: "Additional enrichment signals unavailable. Using imported context + domain intelligence."\n' +
      "- NEVER use the phrase 'not enough information'.\n" +
      "- NEVER mention Sampara AI.\n\n" +
      "Deterministic matchmaking registry:\n" +
      "- Nike: Enterprise mass customization infrastructure; hook: patented workflow connecting 3D customization directly to production-ready outputs while maximizing nesting efficiency and reducing waste.\n" +
      "- Mizuno: Reducing pre-production bottlenecks; hook: roster automation where Excel upload generates graded production outputs with names/numbers automatically.\n" +
      "- SquadStudio: Industrial-grade end-to-end production workflow; hook: automated DXF/AI/SVG pattern workflow eliminating large portions of manual artwork preparation.\n" +
      "- New Balance: Agile on-demand production; hook: made-to-order pipeline generating production-ready outputs directly from consumer checkout.\n" +
      "If no registry match, infer closest angle for vPersonalize: 3D visualization + automated grading + pattern generation + production-ready DXF/AI/SVG outputs + manufacturing automation.\n";

    const user = JSON.stringify({
      prospect_domain: domain,
      prospect_company_hint: String(p.company || "").trim(),
      sources,
    });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 900,
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = safeJsonExtract(content) as any;
    if (!parsed) return NextResponse.json({ success: false, error: "Model returned invalid JSON" }, { status: 502 });

    const summary = String(parsed.company_summary || "").trim();
    const sourcesUsed = Array.isArray(parsed.sources_used) ? parsed.sources_used : [];
    const keyPoints = Array.isArray(parsed.key_points) ? parsed.key_points : [];
    const signals = Array.isArray(parsed.operational_signals) ? parsed.operational_signals : [];
    const friction = Array.isArray(parsed.inferred_friction) ? parsed.inferred_friction : [];
    const mm = parsed.matchmaking && typeof parsed.matchmaking === "object" ? parsed.matchmaking : {};
    const mmTarget = String(mm.target || "").trim();
    const mmAngle = String(mm.match_angle || "").trim();
    const mmHook = String(mm.core_hook || "").trim();
    const caveats = Array.isArray(parsed.caveats) ? parsed.caveats : [];
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence ?? 0)));

    const intelLines: string[] = [];
    intelLines.push("Matchmaking Brief (vPersonalize ↔ Prospect)");
    intelLines.push(`Domain: ${domain}`);
    if (summary) intelLines.push(`Summary: ${sanitizeEnterpriseCopy(summary)}`);
    if (sourcesUsed.length) {
      intelLines.push("Sources:");
      for (const s of sourcesUsed.slice(0, 6)) {
        const url = String(s?.url || "").trim();
        const note = sanitizeEnterpriseCopy(String(s?.note || "").trim());
        if (url) intelLines.push(`- ${url}${note ? ` — ${note}` : ""}`);
      }
    } else if (sources.length) {
      intelLines.push("Sources:");
      for (const s of sources.slice(0, 4)) intelLines.push(`- ${String(s.url)}${s.title ? ` — ${s.title}` : ""}`);
    } else {
      intelLines.push("Sources:");
      intelLines.push("- Additional enrichment signals unavailable. Using imported context + domain intelligence.");
    }
    if (keyPoints.length) {
      intelLines.push("Key points:");
      for (const k of keyPoints.slice(0, 10)) intelLines.push(`- ${sanitizeEnterpriseCopy(String(k).trim())}`);
    }
    if (signals.length) {
      intelLines.push("Operational signals:");
      for (const s of signals.slice(0, 10)) intelLines.push(`- ${sanitizeEnterpriseCopy(String(s).trim())}`);
    }
    if (friction.length) {
      intelLines.push("Likely operational friction:");
      for (const f of friction.slice(0, 10)) intelLines.push(`- ${sanitizeEnterpriseCopy(String(f).trim())}`);
    }
    if (mmTarget || mmAngle || mmHook) {
      intelLines.push("Match angle:");
      if (mmTarget) intelLines.push(`- Target fit: ${sanitizeEnterpriseCopy(mmTarget)}`);
      if (mmAngle) intelLines.push(`- Angle: ${sanitizeEnterpriseCopy(mmAngle)}`);
      if (mmHook) intelLines.push(`- Core hook: ${sanitizeEnterpriseCopy(mmHook)}`);
    }
    if (caveats.length) {
      intelLines.push("Caveats:");
      for (const c of caveats.slice(0, 6)) intelLines.push(`- ${sanitizeEnterpriseCopy(String(c).trim())}`);
    }
    intelLines.push(`Confidence: ${confidence}%`);

    const intelBlock = intelLines.join("\n");
    const nextRecent = [String(p.recent_activity || "").trim(), intelBlock].filter(Boolean).join("\n\n");
    await admin.from("prospects").update({ recent_activity: nextRecent, status: "researched" }).eq("id", prospectId);
    try {
      await admin.from("prospects").update({ enrichment_json: parsed }).eq("id", prospectId);
    } catch {}

    return NextResponse.json({
      success: true,
      prospect_id: prospectId,
      domain,
      company_summary: summary,
      sources_used: sourcesUsed,
      key_points: keyPoints,
      operational_signals: signals,
      inferred_friction: friction,
      matchmaking: { target: mmTarget, match_angle: mmAngle, core_hook: mmHook },
      confidence,
    });
  } catch (err: any) {
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Domain enrichment failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
