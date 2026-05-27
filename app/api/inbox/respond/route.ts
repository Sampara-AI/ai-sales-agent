import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";
import Groq from "groq-sdk";
import OpenAI from "openai";

type InboundPayload = {
  mailbox?: string;
  external_thread_id?: string;
  from_email: string;
  to_email: string;
  subject?: string;
  body: string;
};

function normalizeEmail(e: string) {
  return String(e || "").trim().toLowerCase();
}

function vectorLiteral(vec: number[]) {
  return `[${vec.join(",")}]`;
}

async function loadAiSettings(admin: any) {
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
    qualification_line: "If helpful, what product type are you considering, what size range, and roughly how many units?",
    temperature: 0.2,
    max_tokens: 700,
    banned_phrases: ["Sampara AI", "6 patents", "AI Architect"],
  };
  try {
    const res = await admin.from("audit_events").select("meta").eq("action", "ai_settings").order("created_at", { ascending: false }).limit(1);
    const meta = ((res.data || []) as any[])[0]?.meta;
    if (!meta || typeof meta !== "object") return fallback;
    const merged = { ...fallback, ...meta };
    merged.banned_phrases = Array.isArray(merged.banned_phrases) ? merged.banned_phrases : fallback.banned_phrases;
    merged.temperature = typeof merged.temperature === "number" ? merged.temperature : fallback.temperature;
    merged.max_tokens = typeof merged.max_tokens === "number" ? merged.max_tokens : fallback.max_tokens;
    merged.brand_name = sanitizeBrand(merged.brand_name) || "VPersonalize";
    merged.banned_phrases = Array.from(new Set([...(merged.banned_phrases || []), "Sampara AI", "SAMPARA AI", "sampara ai"]));
    return merged;
  } catch {
    return fallback;
  }
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

export async function POST(req: NextRequest) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
  const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);

  if (!isInternal) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!openaiKey) return NextResponse.json({ error: "Missing OPENAI_API_KEY (required for embeddings)" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Partial<InboundPayload>;
  const mailbox = String(body.mailbox || "default").trim();
  const externalThreadId = String(body.external_thread_id || crypto.randomUUID()).trim();
  const fromEmail = normalizeEmail(String(body.from_email || ""));
  const toEmail = normalizeEmail(String(body.to_email || ""));
  const subject = String(body.subject || "").trim();
  const messageBody = String(body.body || "").trim();
  if (!fromEmail || !toEmail || !messageBody) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const admin = createAdminClient();
  const aiSettings = await loadAiSettings(admin as any);

  let prospectId: string | null = null;
  try {
    const pRes = await admin.from("prospects").select("id").ilike("email", fromEmail).limit(1);
    const pid = String(((pRes.data || []) as any[])[0]?.id || "").trim();
    prospectId = pid || null;
  } catch {}

  const threadUpsert = await admin
    .from("inbox_threads")
    .upsert(
      { mailbox, external_id: externalThreadId, subject: subject || null, prospect_id: prospectId, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "mailbox,external_id" },
    )
    .select("id")
    .single();
  if (threadUpsert.error) return NextResponse.json({ error: threadUpsert.error.message }, { status: 500 });

  const msgIns = await admin
    .from("inbox_messages")
    .insert({
      mailbox,
      thread_external_id: externalThreadId,
      external_id: crypto.randomUUID(),
      direction: "inbound",
      from_email: fromEmail,
      to_email: toEmail,
      subject: subject || null,
      snippet: messageBody.replace(/\s+/g, " ").slice(0, 200),
      raw: { subject, body: messageBody },
    })
    .select("id")
    .single();
  if (msgIns.error) return NextResponse.json({ error: msgIns.error.message }, { status: 500 });
  const inboxMessageId = String((msgIns.data as any)?.id || "").trim();

  if (prospectId) {
    try {
      await admin.from("prospects").update({ replied: true, status: "replied" }).eq("id", prospectId);
    } catch {}
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const queryText = [subject, messageBody].filter(Boolean).join("\n\n").slice(0, 8000);
  const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: queryText });
  const embedding = (emb.data?.[0] as any)?.embedding as number[] | undefined;
  if (!embedding || embedding.length < 10) return NextResponse.json({ error: "Embedding generation failed" }, { status: 502 });

  const matches = await admin.rpc("match_knowledge_chunks", { query_embedding: vectorLiteral(embedding), match_count: 6 });
  const chunks = ((matches.data || []) as any[]).map((m) => ({
    chunk_id: String(m.id || ""),
    similarity: Number(m.similarity || 0),
    content: String(m.content || "").slice(0, 1600),
  }));

  const groq = new Groq({ apiKey: groqKey });
  const banned = Array.isArray((aiSettings as any)?.banned_phrases) ? (aiSettings as any).banned_phrases : [];
  const qualificationLine = String((aiSettings as any)?.qualification_line || "").trim();
  const system =
    `You are a production email assistant writing on behalf of ${String((aiSettings as any)?.brand_name || "VPersonalize")}.\n\n` +
    `Brand website: ${String((aiSettings as any)?.brand_website || "https://www.vpersonalize.com")}\n` +
    `CTA: ${String((aiSettings as any)?.cta_text || "Book a quick 15-minute chat")} (${String((aiSettings as any)?.cta_url || "https://cal.com/vpersonalize/intro")})\n\n` +
    "You must be grounded and product-aware.\n\n" +
    "You will receive:\n- inbound_email (subject/body)\n- knowledge_context (snippets with chunk_id)\n\n" +
    "Task:\n1) Classify intent into one of: curiosity | pricing_inquiry | technical_evaluation | implementation_inquiry | meeting_intent | objection | unsubscribe\n2) Draft a concise businesslike reply (no hype). Use only the provided knowledge snippets as factual basis.\n3) If knowledge is insufficient, ask 1-2 clarifying questions and do NOT invent details.\n4) Decide whether to escalate to a human when intent is pricing_inquiry OR meeting_intent OR implementation_inquiry OR technical_evaluation.\n\n" +
    "Also extract commercial signal dimensions for enterprise evaluation:\n" +
    "- buying_intent: low | medium | high\n" +
    "- urgency: low | medium | high\n" +
    "- objections: string[]\n" +
    "- technical_depth: low | medium | high\n" +
    "- pricing_sensitivity: low | medium | high\n" +
    "- integration_complexity: low | medium | high\n\n" +
    "Return JSON only with this schema:\n" +
    "{\n" +
    "  intent: string,\n" +
    "  escalate: boolean,\n" +
    "  confidence: number,\n" +
    "  buying_intent: string,\n" +
    "  urgency: string,\n" +
    "  objections: string[],\n" +
    "  technical_depth: string,\n" +
    "  pricing_sensitivity: string,\n" +
    "  integration_complexity: string,\n" +
    "  summary: string,\n" +
    "  next_action: string,\n" +
    "  response_subject: string,\n" +
    "  response_body: string,\n" +
    "  references: { chunk_id: string, note: string }[]\n" +
    "}\n\n" +
    "Rules:\n- confidence: 0-100\n- response_body: 80-150 words\n- no emojis, no markdown, no exclamation points\n- references should cite which chunk_id(s) were used and why (internal traceability)" +
    "\n- NEVER use the word 'merch' (use merchandise, teamwear, custom apparel)" +
    (qualificationLine ? `\n- Include this polite qualifier line once when relevant: "${qualificationLine}"` : "") +
    (banned.length ? `\n- Do not mention these phrases: ${banned.map((x: string) => `"${x}"`).join(", ")}` : "");

  const user = JSON.stringify({
    inbound_email: { subject, from_email: fromEmail, to_email: toEmail, body: messageBody },
    knowledge_context: chunks,
  });

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

  const content = completion.choices?.[0]?.message?.content ?? "";
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 502 });

  let parsed: any = null;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 502 });
  }

  const intent = String(parsed?.intent || "").trim() || "curiosity";
  const escalate = Boolean(parsed?.escalate);
  const confidence = Math.max(0, Math.min(100, Number(parsed?.confidence ?? 0)));
  const buyingIntent = String(parsed?.buying_intent || "").trim() || "medium";
  const urgency = String(parsed?.urgency || "").trim() || "medium";
  const objections = Array.isArray(parsed?.objections) ? parsed.objections.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 8) : [];
  const technicalDepth = String(parsed?.technical_depth || "").trim() || "medium";
  const pricingSensitivity = String(parsed?.pricing_sensitivity || "").trim() || "medium";
  const integrationComplexity = String(parsed?.integration_complexity || "").trim() || "medium";
  const summary = sanitizeEnterpriseCopy(String(parsed?.summary || "").trim());
  const nextAction = sanitizeEnterpriseCopy(String(parsed?.next_action || "").trim());
  const responseSubject = String(parsed?.response_subject || "").trim() || (subject ? `Re: ${subject}` : "Re:");
  const responseBody = sanitizeEnterpriseCopy(String(parsed?.response_body || "").trim());
  const references = Array.isArray(parsed?.references) ? parsed.references : [];

  let signal: "Hot" | "Warm" | "Cold" | "Dead" | "Escalation Required" = "Cold";
  if (intent === "unsubscribe") signal = "Dead";
  else if (escalate) signal = "Escalation Required";
  else if (intent === "meeting_intent") signal = "Hot";
  else if (intent === "pricing_inquiry") signal = "Hot";
  else if (intent === "implementation_inquiry" || intent === "technical_evaluation") signal = "Warm";
  else if (intent === "objection") signal = "Cold";
  else signal = "Cold";

  const recommendedAction = nextAction || (signal === "Hot" ? "Schedule a quick call." : signal === "Warm" ? "Answer questions and propose next step." : "Ask one clarifying question.");
  const signalReason = summary || (signal === "Escalation Required" ? "Reply requires human review due to commercial/technical risk." : "Classified based on reply content.");

  const upd = await admin
    .from("inbox_messages")
    .update({
      intent,
      escalated: escalate,
      ai_summary: summary || null,
      ai_next_action: nextAction || null,
      ai_confidence: confidence,
      ai_draft_subject: responseSubject,
      ai_draft_body: responseBody,
      knowledge_refs: references,
      processed_at: new Date().toISOString(),
      classification: signal,
    })
    .eq("id", inboxMessageId);
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    thread: { mailbox, external_id: externalThreadId, prospect_id: prospectId },
    prospect_id: prospectId,
    inbound_message_id: inboxMessageId,
    intent,
    escalate,
    confidence,
    buying_intent: buyingIntent,
    urgency,
    objections,
    technical_depth: technicalDepth,
    pricing_sensitivity: pricingSensitivity,
    integration_complexity: integrationComplexity,
    signal,
    signal_reason: signalReason,
    recommended_action: recommendedAction,
    summary,
    next_action: nextAction,
    response_subject: responseSubject,
    response_body: responseBody,
    references,
  });
}
