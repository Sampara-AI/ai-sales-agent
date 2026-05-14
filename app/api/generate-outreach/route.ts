import { NextResponse, NextRequest } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { enqueueJob } from "@/lib/server/job-queue";

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
    const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
    const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
    const isInternal = !!internalSecret && internalHeader === internalSecret;
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
    const input = body || {};
    let name = input.name || "";
    let title = input.title || "";
    let company = input.company || "";
    let industry = input.industry || "";
    let recent_activity = input.recent_activity || "";
    let pain_points = input.pain_points || "";
    let source = input.source || "";
    const prospect_id = input.prospect_id;

    if (prospect_id) {
      const pRes = await adminDb
        .from("prospects")
        .select("id,name,title,company,industry,email,source,recent_activity,fit_reasoning")
        .eq("id", prospect_id)
        .single();
      if (!pRes.error && pRes.data) {
        const p: any = pRes.data;
        name = String(p.name || name);
        title = String(p.title || title);
        company = String(p.company || company);
        industry = String(p.industry || industry);
        source = String(p.source || source);
        const ra = [p.recent_activity, p.fit_reasoning].filter(Boolean).join("\n");
        recent_activity = ra || recent_activity;
      }
    }

    if (!name || !company) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    const groq = new Groq({ apiKey });
    const system =
      "You are an expert at writing personalized cold outreach emails for enterprise AI sales.\n\n" +
      "Rules:\n- Reference something SPECIFIC about their company or recent activity\n- Identify a likely pain point for their role/industry\n- Mention relevant experience (6 patents in AI) naturally\n- Soft CTA: offer value first (assessment, insights, resource)\n- Tone: Peer-to-peer consultant, NOT salesperson\n- Length: 70-100 words MAX\n- No buzzwords or hype\n- Sound human and thoughtful\n\n" +
      "- If recent_activity includes 'Domain intel', use exactly 1 concrete detail from it (no guessing)\n" +
      "- No emojis, no markdown, no exclamation points\n" +
      "- 1 short question max\n" +
      "- Keep it 70-90 words\n\n" +
      "The founder has 6 patents in:\n- Enterprise AI architecture\n- ML model deployment at scale\n- AI governance frameworks\n\nRecent case studies:\n- Fintech company: 40% cost reduction in AI infrastructure\n- Healthcare: HIPAA-compliant AI implementation\n- Manufacturing: Predictive maintenance AI (3x ROI)\n\n" +
      "Email structure:\n1) Specific observation about them/company\n2-3) Relevant challenge/opportunity\n4) Brief credibility (patent or case study)\n5) Soft ask with value offer\nSignature: Just name + \"AI Architect, 6 Patents\"\n\n" +
      "Subject lines:\n- Insight-based: \"[Insight] about [their company]'s AI strategy\"\n- Question-based: \"Quick question about [specific challenge]\"\n- Value-based: \"[Resource] for [their role] at [company]\"\n\n" +
      "Return JSON only: { email_body: string, subject_lines: string[], personalization_score: number, confidence_score: number, reasoning: string }\n\n" +
      "Good examples:\n- \"Noticed your team open-sourced an inference toolkit last week. Many teams at your scale hit latency and cost tradeoffs—happy to share a 30-minute assessment we used to cut infra costs 40% at a fintech. I'm an AI architect (6 patents). Want a quick audit checklist?\"\n\n" +
      "Bad examples:\n- \"We are the leading AI platform to revolutionize your workflows!!!\"\n- \"Let's hop on a call to discuss synergies.\"\n";

    const user = JSON.stringify({ name, title, company, industry, recent_activity, pain_points, source });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as OutreachResult | null;
    if (!parsed || !Array.isArray(parsed.subject_lines) || typeof parsed.email_body !== "string") {
      return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 502 });
    }

    const personalization_score = Math.max(0, Math.min(100, Number(parsed.personalization_score ?? 0)));
    const confidence_score = Math.max(0, Math.min(100, Number(parsed.confidence_score ?? 0)));
    const result: OutreachResult = {
      email_body: parsed.email_body,
      subject_lines: parsed.subject_lines.slice(0, 3),
      personalization_score,
      confidence_score,
      reasoning: parsed.reasoning ?? "",
    };

    const insertPayload = {
      prospect_id: prospect_id || null,
      subject_lines: result.subject_lines,
      body: result.email_body,
      personalization_score: result.personalization_score,
      confidence_score: result.confidence_score,
      status: "draft",
    };
    const insertRes = await adminDb.from("email_drafts").insert(insertPayload).select("id").single();
    if (insertRes.error) console.error("generate-outreach save error", insertRes.error);
    const emailDraftId = String((insertRes.data as any)?.id || "").trim() || null;
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
          const fromName = process.env.DEFAULT_FROM_NAME || "Tuple AI";
          const fromEmail = process.env.DEFAULT_FROM_EMAIL || "founder@tuple.ai";
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

    return NextResponse.json({ ...result, queued_send });
  } catch (err: any) {
    console.error("generate-outreach error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Outreach generation failed";
    if (Number(code) === 429) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
