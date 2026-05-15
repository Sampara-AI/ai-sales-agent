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
  const system =
    "You are a production email assistant for enterprise outbound. You must be grounded and product-aware.\n\n" +
    "You will receive:\n- inbound_email (subject/body)\n- knowledge_context (snippets with chunk_id)\n\n" +
    "Task:\n1) Classify intent into one of: curiosity | pricing_inquiry | technical_evaluation | implementation_inquiry | meeting_intent | objection | unsubscribe\n2) Draft a concise businesslike reply (no hype). Use only the provided knowledge snippets as factual basis.\n3) If knowledge is insufficient, ask 1-2 clarifying questions and do NOT invent details.\n4) Decide whether to escalate to a human when intent is pricing_inquiry OR meeting_intent OR implementation_inquiry OR technical_evaluation.\n\n" +
    "Return JSON only with this schema:\n" +
    "{ intent: string, escalate: boolean, confidence: number, summary: string, next_action: string, response_subject: string, response_body: string, references: { chunk_id: string, note: string }[] }\n\n" +
    "Rules:\n- confidence: 0-100\n- response_body: 80-150 words\n- no emojis, no markdown, no exclamation points\n- references should cite which chunk_id(s) were used and why (internal traceability)";

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
    temperature: 0.2,
    max_tokens: 700,
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
  const summary = String(parsed?.summary || "").trim();
  const nextAction = String(parsed?.next_action || "").trim();
  const responseSubject = String(parsed?.response_subject || "").trim() || (subject ? `Re: ${subject}` : "Re:");
  const responseBody = String(parsed?.response_body || "").trim();
  const references = Array.isArray(parsed?.references) ? parsed.references : [];

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
      classification: intent,
    })
    .eq("id", inboxMessageId);
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    thread: { mailbox, external_id: externalThreadId, prospect_id: prospectId },
    inbound_message_id: inboxMessageId,
    intent,
    escalate,
    confidence,
    summary,
    next_action: nextAction,
    response_subject: responseSubject,
    response_body: responseBody,
    references,
  });
}
