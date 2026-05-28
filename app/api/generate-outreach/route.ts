import { NextResponse, NextRequest } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { enqueueJob } from "@/lib/server/job-queue";
import OpenAI from "openai";

type ProspectInput = {
  name?: string;
  title?: string;
  company?: string;
  industry?: string;
  recent_activity?: string;
  pain_points?: string;
  source?: string;
  prospect_id?: string;
  enqueue_only?: boolean;
};

type OutreachResult = {
  email_body: string;
  subject_lines: string[];
  personalization_score: number;
  confidence_score: number;
  reasoning: string;
};

function vectorLiteral(vec: number[]) {
  return `[${vec.join(",")}]`;
}

function sanitizeEnterpriseCopy(text: string) {
  const t = String(text || "");
  return t
    .replace(/sampara ai/gi, "VPersonalize")
    .replace(/\btuple ai\b/gi, "VPersonalize")
    .replace(/\bmerch\b/gi, "merchandise")
    .replace(/not enough information( is| was)? available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/not enough information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/limited information available/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.")
    .replace(/insufficient information/gi, "Additional enrichment signals unavailable. Using imported context + domain intelligence.");
}

function cleanPromptText(input: string) {
  const s = String(input || "");
  const withoutCode = s.replace(/```[\s\S]*?```/g, " ");
  const withoutLinks = withoutCode.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const withoutHeadings = withoutLinks.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  const withoutMdBullets = withoutHeadings.replace(/^\s*[-*+]\s+/gm, "");
  return withoutMdBullets.replace(/\s+/g, " ").trim();
}

function resolveMatchmakingAngle(input: { company?: string; domain?: string }) {
  const rawCompany = String(input.company || "").trim();
  const rawDomain = String(input.domain || "").trim().toLowerCase();
  const key = `${rawCompany} ${rawDomain}`.toLowerCase();
  const isNike = /\bnike\b/.test(key) || rawDomain.includes("nike.");
  const isMizuno = /\bmizuno\b/.test(key) || rawDomain.includes("mizuno.");
  const isSquadStudio = /\bsquadstudio\b/.test(key) || rawDomain.includes("squadstudio");
  const isNewBalance = /new\s*balance/.test(key) || rawDomain.includes("newbalance");

  if (isNike) {
    return {
      registry_target: "Nike",
      pain_points: ["scale friction", "global manufacturing consistency", "sustainability pressure", "digital-to-factory translation complexity"],
      match_angle: "Enterprise mass customization infrastructure",
      core_hook:
        "Patented workflow connecting 3D customization directly to production-ready manufacturing outputs while maximizing nesting efficiency and reducing waste.",
    };
  }
  if (isMizuno) {
    return {
      registry_target: "Mizuno",
      pain_points: ["high labor overhead", "rapid teamwear scaling", "turnaround delays", "operational complexity"],
      match_angle: "Reducing pre-production bottlenecks",
      core_hook: "Roster automation: Excel upload directly generates graded production outputs with names/numbers automatically.",
    };
  }
  if (isSquadStudio) {
    return {
      registry_target: "SquadStudio",
      pain_points: ["manual artwork prep", "disconnected workflows", "plugin dependency", "fragmented production flow"],
      match_angle: "Industrial-grade end-to-end production workflow",
      core_hook: "Automated DXF/AI/SVG pattern workflow eliminating large portions of manual artwork preparation.",
    };
  }
  if (isNewBalance) {
    return {
      registry_target: "New Balance",
      pain_points: ["inventory overhead", "made-to-order complexity", "multi-SKU management", "custom line scaling"],
      match_angle: "Agile on-demand production",
      core_hook: "Made-to-order pipeline generating production-ready outputs directly from consumer checkout.",
    };
  }
  return {
    registry_target: "",
    pain_points: [],
    match_angle:
      "Operational matchmaking for mass customization: connect digital customization directly to production-ready manufacturing files (DXF/AI/SVG), automate grading/pattern generation, reduce pre-production overhead, and improve factory throughput.",
    core_hook:
      "vPersonalize connects customer customization directly to production-ready manufacturing outputs (not just mockups), helping reduce manual pre-production work and factory friction.",
  };
}

function extractMissingColumnName(message: string, table: string) {
  const msg = String(message || "");
  const m =
    msg.match(new RegExp(`Could not find the '([^']+)' column of '${table}'`, "i")) ||
    msg.match(new RegExp(`column \"([^\"]+)\" of relation \"${table}\" does not exist`, "i")) ||
    msg.match(/column \"([^\"]+)\" does not exist/i);
  return m?.[1] ? String(m[1]) : "";
}

async function loadAiSettings(adminDb: any) {
  const sanitizeBrand = (value: any) => {
    const v = String(value || "").trim();
    if (!v) return v;
    return /sampara/i.test(v) ? "VPersonalize" : v;
  };
  const fallback = {
    brand_name: String(process.env.NEXT_PUBLIC_BRAND_NAME || process.env.DEFAULT_FROM_NAME || "VPersonalize").trim(),
    brand_website: String(process.env.EMAIL_BRAND_URL || process.env.NEXT_PUBLIC_BRAND_URL || "https://www.vpersonalize.com").trim(),
    brand_one_liner: String(
      process.env.NEXT_PUBLIC_BRAND_ONE_LINER ||
        "Enterprise manufacturing intelligence platform connecting digital customization directly to production-ready manufacturing files.",
    ).trim(),
    tone: "Exciting and confident, not pushy. Value-first. One clear CTA.",
    cta_text: String(process.env.EMAIL_FOOTER_LINK_TEXT || "Book a quick 15-minute chat").trim(),
    cta_url: String(process.env.EMAIL_FOOTER_LINK_URL || "https://cal.com/vpersonalize/intro").trim(),
    qualification_line: "If helpful, what product type are you considering, what size range, and roughly how many units?",
    sender_name: String(process.env.DEFAULT_FROM_NAME || "VPersonalize").trim(),
    sender_title: String(process.env.EMAIL_SIGNATURE_TITLE || "Partnerships").trim(),
    sender_company: String(process.env.EMAIL_SIGNATURE_COMPANY || "VPersonalize").trim(),
    credibility_line: String(process.env.EMAIL_CREDIBILITY_LINE || "").trim(),
    temperature: 0.55,
    max_tokens: 700,
    banned_phrases: ["Sampara AI", "6 patents", "AI Architect"],
  };
  try {
    const res = await adminDb.from("audit_events").select("meta").eq("action", "ai_settings").order("created_at", { ascending: false }).limit(1);
    const meta = ((res.data || []) as any[])[0]?.meta;
    if (!meta || typeof meta !== "object") return fallback;
    const merged = { ...fallback, ...meta };
    merged.banned_phrases = Array.isArray(merged.banned_phrases) ? merged.banned_phrases : fallback.banned_phrases;
    merged.temperature = typeof merged.temperature === "number" ? merged.temperature : fallback.temperature;
    merged.max_tokens = typeof merged.max_tokens === "number" ? merged.max_tokens : fallback.max_tokens;
    merged.brand_name = sanitizeBrand(merged.brand_name) || "VPersonalize";
    merged.sender_name = sanitizeBrand(merged.sender_name) || "VPersonalize";
    merged.sender_company = sanitizeBrand(merged.sender_company) || "VPersonalize";
    merged.banned_phrases = Array.from(new Set([...(merged.banned_phrases || []), "Sampara AI", "SAMPARA AI", "sampara ai"]));
    return merged;
  } catch {
    return fallback;
  }
}

const extractJson = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!supabaseUrl || !supabaseServiceKey) return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as ProspectInput;
    const enqueueOnly = Boolean((body as any)?.enqueue_only);
    const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
    const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
    const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
    const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);
    if (!isInternal) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (enqueueOnly) {
      const prospectId = String((body as any)?.prospect_id || "").trim();
      if (!prospectId) return NextResponse.json({ error: "Missing prospect_id" }, { status: 400 });
      const jobId = await enqueueJob("generate_outreach", { prospect_id: prospectId }, { priority: 130, runAfter: new Date() });
      return NextResponse.json({ success: true, queued: true, job_id: jobId, prospect_id: prospectId }, { status: 202 });
    }

    if (!apiKey) return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
    const adminDb = createClient(supabaseUrl, supabaseServiceKey);
    const aiSettings = await loadAiSettings(adminDb);
    const input = body || {};
    let name = input.name || "";
    let title = input.title || "";
    let company = input.company || "";
    let industry = input.industry || "";
    let recent_activity = input.recent_activity || "";
    let pain_points = input.pain_points || "";
    let source = input.source || "";
    const prospect_id = input.prospect_id;
    let prospectDomain = "";

    if (prospect_id) {
      const pRes = await adminDb
        .from("prospects")
        .select("id,name,title,company,industry,email,domain,source,recent_activity,fit_reasoning")
        .eq("id", prospect_id)
        .single();
      if (!pRes.error && pRes.data) {
        const p: any = pRes.data;
        name = String(p.name || name);
        title = String(p.title || title);
        company = String(p.company || company);
        industry = String(p.industry || industry);
        source = String(p.source || source);
        prospectDomain = String(p.domain || "").trim();
        const ra = [p.recent_activity, p.fit_reasoning].filter(Boolean).join("\n");
        recent_activity = ra || recent_activity;
        if (!prospectDomain && String(p.email || "").includes("@")) {
          prospectDomain = String(p.email || "").split("@")[1]?.trim()?.toLowerCase() || "";
        }
      }
    }

    const cleanedCompany = String(company || "").trim();
    const cleanedName = String(name || "").trim();
    const fallbackCompany = String(prospectDomain || "").trim();
    company = cleanedCompany || fallbackCompany || "your team";
    name = cleanedName || company || "there";

    const matchmaking = resolveMatchmakingAngle({ company, domain: prospectDomain });

    const groq = new Groq({ apiKey });
    const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
    let knowledgeContext = "";
    let knowledgeUsed = false;
    if (openaiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const q = [
          aiSettings.brand_name,
          aiSettings.brand_one_liner,
          company,
          title,
          recent_activity,
          pain_points,
        ].filter(Boolean).join("\n");
        const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: q.slice(0, 8000) });
        const embedding = (emb.data?.[0] as any)?.embedding as number[] | undefined;
        if (embedding && embedding.length > 10) {
          const matches = await adminDb.rpc("match_knowledge_chunks", { query_embedding: vectorLiteral(embedding), match_count: 6 });
          const chunks = ((matches.data || []) as any[])
            .map((m) => String(m.content || "").trim())
            .filter(Boolean)
            .slice(0, 6);
          if (chunks.length) {
            knowledgeContext = cleanPromptText(chunks.join("\n\n---\n\n")).slice(0, 5000);
            knowledgeUsed = true;
          }
        }
      } catch {}
    }

    const banned = Array.isArray(aiSettings.banned_phrases) ? aiSettings.banned_phrases : [];
    const qualificationLine = String((aiSettings as any)?.qualification_line || "").trim();
    const system =
      `You write highly personalized, commercially intelligent outreach emails on behalf of ${aiSettings.brand_name} (vPersonalize).\n\n` +
      `vPersonalize positioning:\n` +
      `- Enterprise manufacturing intelligence platform\n` +
      `- Connects digital customization directly to production-ready manufacturing files (DXF/AI/SVG), not just mockups\n` +
      `- Automates grading and pattern generation, reduces manual pre-production work, reduces factory friction, supports made-to-order workflows\n\n` +
      `Brand context:\n- Brand: ${aiSettings.brand_name}\n- Website: ${aiSettings.brand_website}\n- One-liner: ${aiSettings.brand_one_liner}\n\n` +
      `Matchmaking registry (deterministic):\n` +
      (matchmaking.registry_target
        ? `- Target match: ${matchmaking.registry_target}\n- Match angle: ${matchmaking.match_angle}\n- Core hook: ${matchmaking.core_hook}\n`
        : `- Match angle: ${matchmaking.match_angle}\n- Core hook: ${matchmaking.core_hook}\n`) +
      `Tone:\n${aiSettings.tone}\n\n` +
      "Rules:\n" +
      "- Start with a sharp operational observation derived from recent_activity (sources, key points, signals)\n" +
      "- Identify likely friction/pain (commercially reasonable inference)\n" +
      "- Connect the specific vPersonalize capability that matches that friction (matchmaking)\n" +
      "- Use only facts from recent_activity (including enrichment sources) and knowledge_context as factual basis; inference is allowed but fabrication is prohibited\n" +
      "- Avoid stalker-ish phrasing; do not claim private/internal facts\n" +
      "- NEVER use 'hope this email finds you well'\n" +
      "- NEVER use the word 'merch' (use merchandise, teamwear, custom apparel)\n" +
      "- Keep it 90-140 words\n" +
      "- 1 clear CTA framed consultatively (not 'book a call'); ask what they optimize for (turnaround / flexibility / inventory / automation / consistency)\n" +
      (qualificationLine ? `- Include this polite qualifier line once when relevant: "${qualificationLine}"\n` : "") +
      "- No emojis, no markdown, no exclamation points\n" +
      "- Avoid hype/buzzwords\n" +
      `- Do not mention these phrases: ${banned.map((x: string) => `"${x}"`).join(", ")}\n\n` +
      "Output JSON only: { email_body: string, subject_lines: string[], personalization_score: number, confidence_score: number, reasoning: string }\n";

    const user = JSON.stringify({
      prospect: { name, title, company, industry },
      recent_activity,
      pain_points,
      source,
      cta: { text: aiSettings.cta_text, url: aiSettings.cta_url },
      sender: { name: aiSettings.sender_name, title: aiSettings.sender_title, company: aiSettings.sender_company, credibility_line: aiSettings.credibility_line },
      knowledge_context: knowledgeContext,
    });

    let completionContent = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.55,
        top_p: 0.9,
        max_tokens: 900,
        presence_penalty: 0.4,
        frequency_penalty: 0.35,
      });
      completionContent = completion.choices?.[0]?.message?.content ?? "";
      if (!banned.length) break;
      const lower = completionContent.toLowerCase();
      const hit = banned.find((p: string) => p && lower.includes(String(p).toLowerCase()));
      if (!hit) break;
    }

    const parsed = extractJson(completionContent) as OutreachResult | null;
    if (!parsed || !Array.isArray(parsed.subject_lines) || typeof parsed.email_body !== "string") {
      return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 502 });
    }

    const personalization_score = Math.max(0, Math.min(100, Number(parsed.personalization_score ?? 0)));
    const confidence_score = Math.max(0, Math.min(100, Number(parsed.confidence_score ?? 0)));
    const result: OutreachResult = {
      email_body: sanitizeEnterpriseCopy(parsed.email_body),
      subject_lines: parsed.subject_lines.slice(0, 3),
      personalization_score,
      confidence_score,
      reasoning: sanitizeEnterpriseCopy(parsed.reasoning ?? ""),
    };

    const insertPayload = {
      prospect_id: prospect_id || null,
      subject_lines: result.subject_lines,
      body: result.email_body,
      personalization_score: result.personalization_score,
      confidence_score: result.confidence_score,
      status: "draft",
    };
    let draftPayload: Record<string, any> = { ...insertPayload };
    let insertRes: any = null;
    for (let i = 0; i < 12; i++) {
      const res = await adminDb.from("email_drafts").insert(draftPayload).select("id").single();
      if (!res.error) { insertRes = res; break; }
      const missing = extractMissingColumnName(res.error.message || "", "email_drafts");
      if (missing && Object.prototype.hasOwnProperty.call(draftPayload, missing)) {
        delete (draftPayload as any)[missing];
        continue;
      }
      break;
    }
    if (!insertRes || insertRes.error) console.error("generate-outreach save error", insertRes?.error || "unknown");
    const emailDraftId = String((insertRes?.data as any)?.id || "").trim() || null;
    if (prospect_id) {
      await adminDb.from("prospects").update({ status: "email_ready" }).eq("id", prospect_id);
    }

    let queued_send = false;
    if (prospect_id && emailDraftId) {
      try {
        const pRes = await adminDb.from("prospects").select("id,email,campaign_id").eq("id", prospect_id).single();
        const p: any = pRes.data;
        const toEmail = String(p?.email || "").trim();
        const campaignId = String(p?.campaign_id || "").trim();
        let requireManual = false;
        if (campaignId) {
          const cRes = await adminDb.from("hunting_campaigns").select("require_manual_review").eq("id", campaignId).single();
          requireManual = Boolean((cRes.data as any)?.require_manual_review);
        }
        if (!requireManual && toEmail) {
          const subject = result.subject_lines?.[0] || `Quick note for ${toEmail}`;
          const fromName = String(process.env.DEFAULT_FROM_NAME || "vPersonalize Team").trim();
          const fromEmail = String(process.env.DEFAULT_FROM_EMAIL || "hello@tupleai.co.in").trim();
          const follow1 = Math.max(1, Number(process.env.DEFAULT_FOLLOWUP_DAYS || 3));
          const nextFollow = new Date(Date.now() + follow1 * 86400000).toISOString();
          await enqueueJob(
            "send_email",
            {
              prospect_id,
              email_draft_id: emailDraftId,
              to_email: toEmail,
              subject,
              body: result.email_body,
              from_name: fromName,
              from_email: fromEmail,
              next_followup_date: nextFollow,
            },
            { priority: 100, runAfter: new Date() },
          );
          queued_send = true;
        }
      } catch {}
    }

    return NextResponse.json({
      ...result,
      queued_send,
      knowledge_used: knowledgeUsed,
      knowledge_preview: knowledgeContext ? knowledgeContext.slice(0, 800) : "",
    });
  } catch (err: any) {
    console.error("generate-outreach error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Outreach generation failed";
    if (Number(code) === 429) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
